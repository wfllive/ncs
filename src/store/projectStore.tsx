import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createDefaultProject, createDefaultScreen, componentTypes, migrateToComposeProject } from '../utils/defaultProject';
import { generateId } from '../utils/generateId';
import { execute } from '../utils/shellExecutor';
import { getProjectDir } from '../config/runtime';

const PROJECTS_STORAGE_KEY = '@sketchware_projects';
const MAX_UNDO_STACK = 50;

const ProjectContext = createContext(null);

const findTreeNode = (root, id) => {
  if (!root) return null;
  if (root.id === id) return root;
  for (const child of root.children || []) {
    const found = findTreeNode(child, id);
    if (found) return found;
  }
  return null;
};

const findTreeParent = (root, id, parent = null) => {
  if (!root) return null;
  if (root.id === id) return parent;
  for (const child of root.children || []) {
    const found = findTreeParent(child, id, root);
    if (found) return found;
  }
  return null;
};

const appendTreeNode = (root, targetId, node, index = null) => {
  if (root.id === targetId) {
    const children = [...(root.children || [])];
    const insertAt = index == null ? children.length : Math.max(0, Math.min(index, children.length));
    children.splice(insertAt, 0, node);
    return { ...root, children };
  }
  return { ...root, children: (root.children || []).map((child) => appendTreeNode(child, targetId, node, index)) };
};

const detachTreeNode = (root, id) => {
  let removed = null;
  const visit = (node) => {
    const children = [];
    for (const child of node.children || []) {
      if (child.id === id) {
        removed = child;
      } else {
        children.push(visit(child));
      }
    }
    return { ...node, children };
  };
  return { root: visit(root), removed };
};

const initialState = {
  projects: [],
  currentProject: null,
  currentScreenId: null,
  selectedComponentId: null,
  isLoaded: false,
  clipboardComponent: null,
  undoStack: [],
  redoStack: [],
  searchQuery: '',
  workspaceLogs: [],
};

function projectReducer(state, action) {
  switch (action.type) {
    case 'SET_PROJECTS':
      return { ...state, projects: action.payload, isLoaded: true };
    
    case 'CREATE_PROJECT': {
      const newProject = createDefaultProject(action.payload);
      return {
        ...state,
        projects: [...state.projects, newProject],
        currentProject: newProject,
        currentScreenId: newProject.screens[0]?.id,
        undoStack: [],
        redoStack: [],
      };
    }
    
    case 'IMPORT_PROJECT': {
      const imported = { ...action.payload, id: action.payload.id || require('../utils/generateId').generateId() };
      return {
        ...state,
        projects: [...state.projects, imported],
        currentProject: imported,
        currentScreenId: imported.screens[0]?.id,
        undoStack: [],
        redoStack: [],
      };
    }

    case 'DELETE_PROJECT':
      return {
        ...state,
        projects: state.projects.filter(p => p.id !== action.payload),
        currentProject: state.currentProject?.id === action.payload ? null : state.currentProject,
      };
    
    case 'SET_CURRENT_PROJECT':
      return {
        ...state,
        currentProject: action.payload,
        currentScreenId: action.payload?.screens[0]?.id || null,
        selectedComponentId: null,
        undoStack: [],
        redoStack: [],
      };

    case 'CLOSE_PROJECT':
      return {
        ...state,
        currentProject: null,
        currentScreenId: null,
        selectedComponentId: null,
        clipboardComponent: null,
        undoStack: [],
        redoStack: [],
        workspaceLogs: [],
      };
    
    case 'UPDATE_PROJECT': {
      const updatedProject = { ...action.payload, updatedAt: Date.now() };
      return {
        ...state,
        currentProject: updatedProject,
        projects: state.projects.map(p => p.id === updatedProject.id ? updatedProject : p),
      };
    }
    
    case 'SET_CURRENT_SCREEN':
      return { ...state, currentScreenId: action.payload, selectedComponentId: null };
    
    case 'ADD_SCREEN': {
      if (!state.currentProject) return state;
      const newScreen = { ...createDefaultScreen(action.payload.id, action.payload.name), readOnly: false };
      const updatedProject = {
        ...state.currentProject,
        screens: [...state.currentProject.screens, newScreen],
        updatedAt: Date.now(),
      };
      return {
        ...state,
        currentProject: updatedProject,
        projects: state.projects.map(p => p.id === updatedProject.id ? updatedProject : p),
        currentScreenId: newScreen.id,
      };
    }

    case 'DUPLICATE_SCREEN': {
      if (!state.currentProject) return state;
      const sourceScreen = state.currentProject.screens.find(s => s.id === action.payload);
      if (!sourceScreen) return state;
      const newScreen = {
        ...JSON.parse(JSON.stringify(sourceScreen)),
        id: require('../utils/generateId').generateId(),
        name: sourceScreen.name + ' (копия)',
      };
      // Regenerate IDs
      const regenIds = (comp) => ({
        ...comp,
        id: require('../utils/generateId').generateId(),
        children: comp.children ? comp.children.map(regenIds) : [],
      });
      newScreen.rootComponent = regenIds(newScreen.rootComponent);
      const updatedProject = {
        ...state.currentProject,
        screens: [...state.currentProject.screens, newScreen],
        updatedAt: Date.now(),
      };
      return {
        ...state,
        currentProject: updatedProject,
        projects: state.projects.map(p => p.id === updatedProject.id ? updatedProject : p),
        currentScreenId: newScreen.id,
      };
    }
    
    case 'DELETE_SCREEN': {
      if (!state.currentProject) return state;
      const filteredScreens = state.currentProject.screens.filter(s => s.id !== action.payload);
      const updatedProject = {
        ...state.currentProject,
        screens: filteredScreens,
        updatedAt: Date.now(),
      };
      return {
        ...state,
        currentProject: updatedProject,
        projects: state.projects.map(p => p.id === updatedProject.id ? updatedProject : p),
        currentScreenId: state.currentScreenId === action.payload ? filteredScreens[0]?.id : state.currentScreenId,
      };
    }
    
    case 'UPDATE_SCREEN': {
      if (!state.currentProject) return state;
      const updatedProject = {
        ...state.currentProject,
        screens: state.currentProject.screens.map(s => s.id === action.payload.id ? action.payload : s),
        updatedAt: Date.now(),
      };
      return {
        ...state,
        currentProject: updatedProject,
        projects: state.projects.map(p => p.id === updatedProject.id ? updatedProject : p),
      };
    }

    case 'UPDATE_COMPONENT_TREE': {
      if (!state.currentProject) return state;
      const updatedProject = {
        ...state.currentProject,
        screens: state.currentProject.screens.map(s => 
          s.id === state.currentScreenId 
            ? { ...s, rootComponent: action.payload }
            : s
        ),
        updatedAt: Date.now(),
      };
      // Save to undo stack
      const currentScreen = state.currentProject.screens.find(s => s.id === state.currentScreenId);
      const newUndoStack = [...state.undoStack, { type: 'componentTree', data: currentScreen?.rootComponent }];
      if (newUndoStack.length > MAX_UNDO_STACK) newUndoStack.shift();
      return {
        ...state,
        currentProject: updatedProject,
        projects: state.projects.map(p => p.id === updatedProject.id ? updatedProject : p),
        undoStack: newUndoStack,
        redoStack: [],
      };
    }
    
    case 'ADD_COMPONENT': {
      if (!state.currentProject) return state;
      const screen = state.currentProject.screens.find((item) => item.id === state.currentScreenId);
      const definition = componentTypes[action.payload.typeKey];
      if (!screen || !definition) return state;

      let targetId = action.payload.targetId || state.selectedComponentId || screen.rootComponent.id;
      const target = findTreeNode(screen.rootComponent, targetId);
      if (!componentTypes[target?.type]?.isContainer) {
        targetId = findTreeParent(screen.rootComponent, targetId)?.id || screen.rootComponent.id;
      }
      const newComponent = {
        id: generateId(),
        type: action.payload.typeKey,
        props: { ...definition.defaultProps },
        children: [],
      };
      const updatedRoot = appendTreeNode(screen.rootComponent, targetId, newComponent);
      const updatedProject = {
        ...state.currentProject,
        screens: state.currentProject.screens.map((item) => item.id === screen.id ? { ...item, rootComponent: updatedRoot } : item),
        updatedAt: Date.now(),
      };
      const nextUndo = [...state.undoStack, { type: 'componentTree', data: screen.rootComponent }].slice(-MAX_UNDO_STACK);
      return {
        ...state,
        currentProject: updatedProject,
        projects: state.projects.map((item) => item.id === updatedProject.id ? updatedProject : item),
        selectedComponentId: newComponent.id,
        undoStack: nextUndo,
        redoStack: [],
        workspaceLogs: [...state.workspaceLogs, {
          id: generateId(),
          level: 'success',
          text: `Added ${definition.label}`,
          time: Date.now(),
        }].slice(-200),
      };
    }

    case 'MOVE_COMPONENT': {
      if (!state.currentProject || !action.payload.componentId || !action.payload.targetId) return state;
      const screen = state.currentProject.screens.find((item) => item.id === state.currentScreenId);
      if (!screen || action.payload.componentId === screen.rootComponent.id) return state;
      const moving = findTreeNode(screen.rootComponent, action.payload.componentId);
      const target = findTreeNode(screen.rootComponent, action.payload.targetId);
      if (!moving || !target || !componentTypes[target.type]?.isContainer) return state;
      // A component cannot be moved into itself or one of its descendants.
      if (moving.id === target.id || findTreeNode(moving, target.id)) return state;
      const detached = detachTreeNode(screen.rootComponent, moving.id);
      if (!detached.removed) return state;
      const updatedRoot = appendTreeNode(detached.root, target.id, detached.removed, action.payload.index);
      const updatedProject = {
        ...state.currentProject,
        screens: state.currentProject.screens.map((item) => item.id === screen.id ? { ...item, rootComponent: updatedRoot } : item),
        updatedAt: Date.now(),
      };
      return {
        ...state,
        currentProject: updatedProject,
        projects: state.projects.map((item) => item.id === updatedProject.id ? updatedProject : item),
        selectedComponentId: moving.id,
        undoStack: [...state.undoStack, { type: 'componentTree', data: screen.rootComponent }].slice(-MAX_UNDO_STACK),
        redoStack: [],
        workspaceLogs: [...state.workspaceLogs, { id: generateId(), level: 'info', text: `Moved ${moving.type}`, time: Date.now() }].slice(-200),
      };
    }

    case 'ADD_WORKSPACE_LOG':
      return {
        ...state,
        workspaceLogs: [...state.workspaceLogs, {
          id: action.payload.id || generateId(),
          level: action.payload.level || 'info',
          text: action.payload.text,
          time: action.payload.time || Date.now(),
        }].slice(-200),
      };

    case 'CLEAR_WORKSPACE_LOGS':
      return { ...state, workspaceLogs: [] };

    case 'SELECT_COMPONENT':
      return { ...state, selectedComponentId: action.payload };
    
    case 'SET_CLIPBOARD':
      return { ...state, clipboardComponent: action.payload };
    
    case 'UPDATE_BLOCKS': {
      if (!state.currentProject) return state;
      const currentScreen = state.currentProject.screens.find(s => s.id === state.currentScreenId);
      const newUndoStack = [...state.undoStack, { type: 'blocks', data: currentScreen?.blocks }];
      if (newUndoStack.length > MAX_UNDO_STACK) newUndoStack.shift();
      const updatedProject = {
        ...state.currentProject,
        screens: state.currentProject.screens.map(s => 
          s.id === state.currentScreenId 
            ? { ...s, blocks: action.payload }
            : s
        ),
        updatedAt: Date.now(),
      };
      return {
        ...state,
        currentProject: updatedProject,
        projects: state.projects.map(p => p.id === updatedProject.id ? updatedProject : p),
        undoStack: newUndoStack,
        redoStack: [],
      };
    }

    case 'UNDO': {
      if (state.undoStack.length === 0 || !state.currentProject) return state;
      const lastAction = state.undoStack[state.undoStack.length - 1];
      const newUndoStack = state.undoStack.slice(0, -1);
      
      const currentScreen = state.currentProject.screens.find(s => s.id === state.currentScreenId);
      if (!currentScreen) return { ...state, undoStack: newUndoStack };

      let redoData;
      let updatedScreen;
      
      if (lastAction.type === 'componentTree') {
        redoData = { type: 'componentTree', data: currentScreen.rootComponent };
        updatedScreen = { ...currentScreen, rootComponent: lastAction.data };
      } else if (lastAction.type === 'blocks') {
        redoData = { type: 'blocks', data: currentScreen.blocks };
        updatedScreen = { ...currentScreen, blocks: lastAction.data };
      }

      const updatedProject = {
        ...state.currentProject,
        screens: state.currentProject.screens.map(s => s.id === state.currentScreenId ? updatedScreen : s),
        updatedAt: Date.now(),
      };
      
      return {
        ...state,
        currentProject: updatedProject,
        projects: state.projects.map(p => p.id === updatedProject.id ? updatedProject : p),
        undoStack: newUndoStack,
        redoStack: [...state.redoStack, redoData],
      };
    }

    case 'REDO': {
      if (state.redoStack.length === 0 || !state.currentProject) return state;
      const nextAction = state.redoStack[state.redoStack.length - 1];
      const newRedoStack = state.redoStack.slice(0, -1);
      
      const currentScreen = state.currentProject.screens.find(s => s.id === state.currentScreenId);
      if (!currentScreen) return { ...state, redoStack: newRedoStack };

      let undoData;
      let updatedScreen;
      
      if (nextAction.type === 'componentTree') {
        undoData = { type: 'componentTree', data: currentScreen.rootComponent };
        updatedScreen = { ...currentScreen, rootComponent: nextAction.data };
      } else if (nextAction.type === 'blocks') {
        undoData = { type: 'blocks', data: currentScreen.blocks };
        updatedScreen = { ...currentScreen, blocks: nextAction.data };
      }

      const updatedProject = {
        ...state.currentProject,
        screens: state.currentProject.screens.map(s => s.id === state.currentScreenId ? updatedScreen : s),
        updatedAt: Date.now(),
      };
      
      return {
        ...state,
        currentProject: updatedProject,
        projects: state.projects.map(p => p.id === updatedProject.id ? updatedProject : p),
        undoStack: [...state.undoStack, undoData],
        redoStack: newRedoStack,
      };
    }

    case 'ADD_VARIABLE': {
      if (!state.currentProject) return state;
      const updatedProject = {
        ...state.currentProject,
        variables: [...(state.currentProject.variables || []), action.payload],
        updatedAt: Date.now(),
      };
      return {
        ...state,
        currentProject: updatedProject,
        projects: state.projects.map(p => p.id === updatedProject.id ? updatedProject : p),
      };
    }

    case 'DELETE_VARIABLE': {
      if (!state.currentProject) return state;
      const updatedProject = {
        ...state.currentProject,
        variables: (state.currentProject.variables || []).filter(v => v.id !== action.payload),
        updatedAt: Date.now(),
      };
      return {
        ...state,
        currentProject: updatedProject,
        projects: state.projects.map(p => p.id === updatedProject.id ? updatedProject : p),
      };
    }

    case 'SET_SEARCH_QUERY':
      return { ...state, searchQuery: action.payload };
    
    default:
      return state;
  }
}

export const ProjectProvider = ({ children }) => {
  const [state, dispatch] = useReducer(projectReducer, initialState);

  // Load projects from storage
  useEffect(() => {
    const loadProjects = async () => {
      try {
        const stored = await AsyncStorage.getItem(PROJECTS_STORAGE_KEY);
        if (stored) {
            const projects = JSON.parse(stored).map(migrateToComposeProject);
            dispatch({ type: 'SET_PROJECTS', payload: projects });
        } else {
          dispatch({ type: 'SET_PROJECTS', payload: [] });
        }
      } catch (e) {
        console.error('Failed to load projects', e);
        dispatch({ type: 'SET_PROJECTS', payload: [] });
      }
    };
    loadProjects();
  }, []);

  // Save projects to storage whenever they change
  useEffect(() => {
    if (state.isLoaded) {
      AsyncStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(state.projects)).catch(console.error);
    }
  }, [state.projects, state.isLoaded]);

  const createProject = useCallback((name, metadata = {}) => {
    dispatch({ type: 'CREATE_PROJECT', payload: { ...metadata, name } });
  }, []);

  const deleteProject = useCallback(async (id) => {
    // Find the project so we can also remove its on-disk directory.
    // rai keeps the Gradle project under ~/projects/<name>/, and
    // removing only the AsyncStorage record left the directory behind.
    const project = state.projects.find((p) => p.id === id);
    if (project?.projectDir) {
      try {
        await execute(`rm -rf ${JSON.stringify(project.projectDir)}`);
      } catch (error) {
        // Don't block the UI on a missing directory - the project is
        // already gone from the editor's perspective.
      }
    }
    dispatch({ type: 'DELETE_PROJECT', payload: id });
  }, [state.projects]);

  const openProject = useCallback((project) => {
    dispatch({ type: 'SET_CURRENT_PROJECT', payload: project });
  }, []);

  const saveProjectsNow = useCallback(async () => {
    await AsyncStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(state.projects));
    return true;
  }, [state.projects]);

  const closeProject = useCallback(async () => {
    await AsyncStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(state.projects));
    dispatch({ type: 'CLOSE_PROJECT' });
  }, [state.projects]);

  const addScreen = useCallback((name) => {
    dispatch({ type: 'ADD_SCREEN', payload: { name } });
  }, []);

  const deleteScreen = useCallback((screenId) => {
    dispatch({ type: 'DELETE_SCREEN', payload: screenId });
  }, []);

  const duplicateScreen = useCallback((screenId) => {
    dispatch({ type: 'DUPLICATE_SCREEN', payload: screenId });
  }, []);

  const setCurrentScreen = useCallback((screenId) => {
    dispatch({ type: 'SET_CURRENT_SCREEN', payload: screenId });
  }, []);

  const updateComponentTree = useCallback((rootComponent) => {
    dispatch({ type: 'UPDATE_COMPONENT_TREE', payload: rootComponent });
  }, []);

  const selectComponent = useCallback((componentId) => {
    dispatch({ type: 'SELECT_COMPONENT', payload: componentId });
  }, []);

  const addComponent = useCallback((typeKey, targetId = null) => {
    dispatch({ type: 'ADD_COMPONENT', payload: { typeKey, targetId } });
  }, []);

  const moveComponent = useCallback((componentId, targetId, index = null) => {
    dispatch({ type: 'MOVE_COMPONENT', payload: { componentId, targetId, index } });
  }, []);

  const addWorkspaceLog = useCallback((text, level = 'info') => {
    dispatch({ type: 'ADD_WORKSPACE_LOG', payload: { text, level } });
  }, []);

  const clearWorkspaceLogs = useCallback(() => {
    dispatch({ type: 'CLEAR_WORKSPACE_LOGS' });
  }, []);

  const updateBlocks = useCallback((blocks) => {
    dispatch({ type: 'UPDATE_BLOCKS', payload: blocks });
  }, []);

  const undo = useCallback(() => {
    dispatch({ type: 'UNDO' });
  }, []);

  const redo = useCallback(() => {
    dispatch({ type: 'REDO' });
  }, []);

  const addVariable = useCallback((variable) => {
    dispatch({ type: 'ADD_VARIABLE', payload: variable });
  }, []);

  const deleteVariable = useCallback((id) => {
    dispatch({ type: 'DELETE_VARIABLE', payload: id });
  }, []);

  const importProject = useCallback((projectData) => {
    dispatch({ type: 'IMPORT_PROJECT', payload: projectData });
  }, []);

  const getCurrentScreen = useCallback(() => {
    if (!state.currentProject || !state.currentScreenId) return null;
    return state.currentProject.screens.find(s => s.id === state.currentScreenId);
  }, [state.currentProject, state.currentScreenId]);

  const updateScreen = useCallback((screen) => {
    dispatch({ type: 'UPDATE_SCREEN', payload: screen });
  }, []);

  return (
    <ProjectContext.Provider value={{
      ...state,
      dispatch,
      createProject,
      deleteProject,
      openProject,
      saveProjectsNow,
      closeProject,
      addScreen,
      deleteScreen,
      duplicateScreen,
      setCurrentScreen,
      updateComponentTree,
      selectComponent,
      addComponent,
      moveComponent,
      addWorkspaceLog,
      clearWorkspaceLogs,
      updateBlocks,
      undo,
      redo,
      addVariable,
      deleteVariable,
      importProject,
      getCurrentScreen,
      updateScreen,
    }}>
      {children}
    </ProjectContext.Provider>
  );
};

export const useProject = () => {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
};

export default ProjectContext;
