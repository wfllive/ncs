import React, { useMemo, useRef } from 'react';
import { PanResponder, Pressable, Text, View } from 'react-native';
import { Icon } from './Icon';
import { useProject } from '../store/projectStore';
import { useAppSettings } from '../store/appSettings';
import { cn } from "../utils/cn";
const dimension = (value, fallback) => {
  if (value === 'match_parent') return '100%';
  if (value === 'wrap_content' || value == null) return fallback;
  return value;
};
const WidgetRenderer = ({
  component,
  onSelect,
  onEdit,
  onRegisterDropZone,
  onComponentDragStart,
  onComponentDragMove,
  onComponentDrop,
  dropTargetId,
  depth = 0
}) => {
  const {
    selectedComponentId
  } = useProject();
  const {
    colors
  } = useAppSettings();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const viewRef = useRef(null);
  if (!component) return null;
  const p = component.props || {};
  const selected = selectedComponentId === component.id;
  const container = ['Column', 'Row', 'Box', 'LazyColumn', 'Card', 'ElevatedCard', 'Scaffold'].includes(component.type);
  const isDropTarget = dropTargetId === component.id;
  const measure = () => {
    if (!container) return;
    requestAnimationFrame(() => viewRef.current?.measureInWindow?.((x, y, width, height) => {
      onRegisterDropZone?.(component.id, {
        x,
        y,
        width,
        height,
        depth
      });
    }));
  };
  const dragResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event, gesture) => onComponentDragStart?.(component.id, {
      x: gesture.x0,
      y: gesture.y0
    }),
    onPanResponderMove: (event, gesture) => onComponentDragMove?.(component.id, {
      x: gesture.moveX,
      y: gesture.moveY
    }),
    onPanResponderRelease: (event, gesture) => onComponentDrop?.(component.id, {
      x: gesture.moveX,
      y: gesture.moveY
    }),
    onPanResponderTerminate: () => onComponentDrop?.(component.id, null)
  }), [component.id, onComponentDragStart, onComponentDragMove, onComponentDrop]);
  const childProps = {
    onSelect,
    onEdit,
    onRegisterDropZone,
    onComponentDragStart,
    onComponentDragMove,
    onComponentDrop,
    dropTargetId
  };
  const children = () => component.children?.length ? component.children.map(child => <WidgetRenderer key={child.id} component={child} depth={depth + 1} {...childProps} />) : <View className={styles.placeholder}><Icon name="add-outline" size={14} color={colors.textTertiary} /><Text className={styles.placeholderText}>Drop components here</Text></View>;
  const render = () => {
    switch (component.type) {
      case 'Column':
        return <View style={{
          minHeight: depth ? 45 : 420,
          width: dimension(p.width, undefined),
          padding: p.padding ?? 8,
          flexDirection: 'column',
          gap: 4,
          backgroundColor: p.backgroundColor === 'transparent' ? undefined : p.backgroundColor
        }}>{children()}</View>;
      case 'Row':
        return <View style={{
          minHeight: 45,
          width: dimension(p.width, undefined),
          padding: p.padding ?? 8,
          flexDirection: 'row',
          alignItems: 'center',
          gap: Number(p.spacing) || 8,
          backgroundColor: p.backgroundColor === 'transparent' ? undefined : p.backgroundColor
        }}>{children()}</View>;
      case 'Box':
        return <View style={{
          minHeight: 60,
          width: dimension(p.width, undefined),
          padding: p.padding ?? 8,
          backgroundColor: p.backgroundColor === 'transparent' ? undefined : p.backgroundColor
        }}>{children()}</View>;
      case 'LazyColumn':
        return <View className={styles.containerPreview} style={{
          minHeight: Number(p.height) || 90,
          backgroundColor: p.backgroundColor === 'transparent' ? undefined : p.backgroundColor
        }}>{children()}</View>;
      case 'Card':
        return <View className={styles.card} style={{
          padding: p.padding ?? 14,
          borderRadius: p.borderRadius ?? 12,
          backgroundColor: p.backgroundColor || '#FFFFFF'
        }}>{children()}</View>;
      case 'ElevatedCard':
        return <View className={styles.elevatedCard} style={{
          padding: p.padding ?? 14,
          borderRadius: p.borderRadius ?? 12,
          backgroundColor: p.backgroundColor || '#FFFFFF'
        }}>{children()}</View>;
      case 'Scaffold':
        return <View style={{
          flex: 1,
          minHeight: depth ? 60 : 400,
          backgroundColor: p.backgroundColor || '#F8FAFC'
        }}>
            {p.topBar ? <View className={styles.scaffoldTopBar}>
                <Text className={styles.scaffoldTopBarTitle}>{p.topBar.props?.title || 'MyApp'}</Text>
              </View> : null}
            <View style={{
            flex: 1,
            padding: 8
          }}>
              {children()}
            </View>
          </View>;
      case 'Text':
        return <Text style={{
          width: dimension(p.width, undefined),
          padding: p.padding ?? 4,
          fontSize: Number(p.textSize) || 16,
          color: p.textColor || '#111827',
          fontWeight: p.textStyle === 'bold' ? '700' : '400',
          fontStyle: p.textStyle === 'italic' ? 'italic' : 'normal',
          textAlign: p.textAlign === 'center' ? 'center' : p.textAlign === 'end' ? 'right' : 'left'
        }}>{p.text || 'Text'}</Text>;
      case 'Button':
        {
          const btnText = p.text || component.children?.find(c => c.type === 'Text')?.props?.text || 'Button';
          return <View className={styles.button} style={{
            width: dimension(p.width, undefined),
            padding: p.padding ?? 12,
            borderRadius: p.borderRadius ?? 9,
            backgroundColor: p.backgroundColor || '#4F46E5'
          }}><Text style={{
              color: p.textColor || '#FFFFFF',
              fontSize: Number(p.textSize) || 15,
              fontWeight: '700'
            }}>{btnText}</Text></View>;
        }
      case 'OutlinedButton':
        {
          const btnText = p.text || component.children?.find(c => c.type === 'Text')?.props?.text || 'OutlinedButton';
          return <View className={styles.outlinedButton} style={{
            width: dimension(p.width, undefined),
            padding: p.padding ?? 12,
            borderRadius: p.borderRadius ?? 9
          }}><Text style={{
              color: p.textColor || '#4F46E5',
              fontSize: Number(p.textSize) || 15,
              fontWeight: '700'
            }}>{btnText}</Text></View>;
        }
      case 'OutlinedTextField':
        return <View className={styles.input} style={{
          width: dimension(p.width, '100%'),
          padding: p.padding ?? 12,
          borderRadius: p.borderRadius ?? 9,
          backgroundColor: p.backgroundColor || '#FFFFFF'
        }}><Text style={{
            color: p.text ? p.textColor || '#111827' : '#6B7280',
            fontSize: Number(p.textSize) || 15
          }}>{p.text || p.hint || 'Input'}</Text></View>;
      case 'Image':
        return <View className={styles.media} style={{
          width: dimension(p.width, 110),
          height: dimension(p.height, 110),
          borderRadius: p.borderRadius || 8,
          backgroundColor: p.backgroundColor || '#E5E7EB'
        }}><Icon name="image-outline" size={32} color="#64748B" /><Text className={styles.mediaLabel}>Image</Text></View>;
      case 'Checkbox':
        return <View className={styles.row}><Icon name={p.checked ? 'checkbox' : 'square-outline'} size={22} color={p.checked ? '#4F46E5' : '#64748B'} /><Text style={{
            color: p.textColor || '#111827',
            fontSize: Number(p.textSize) || 15
          }}>{p.text || 'Checkbox'}</Text></View>;
      case 'Switch':
        return <View className={styles.row}><Text style={{
            color: p.textColor || '#111827',
            fontSize: 15,
            flex: 1
          }}>{p.text || 'Switch'}</Text><View className={styles.switchTrack} style={{
            backgroundColor: p.checked ? '#4F46E5' : '#94A3B8'
          }}><View className={styles.switchKnob} style={p.checked && {
              alignSelf: 'flex-end'
            }} /></View></View>;
      case 'LinearProgressIndicator':
        return <View className={styles.progress}><View style={{
            width: `${Math.min(100, (Number(p.progress) || 0) <= 1 ? (Number(p.progress) || 0) * 100 : Number(p.progress) || 0)}%`,
            height: '100%',
            borderRadius: 4,
            backgroundColor: p.color || '#4F46E5'
          }} /></View>;
      case 'CircularProgressIndicator':
        return <View className={styles.circular} style={{
          width: Number(p.width) || 48,
          height: Number(p.height) || 48,
          borderColor: p.color || '#4F46E5'
        }} />;
      case 'HorizontalDivider':
        return <View style={{
          height: Number(p.height) || 1,
          backgroundColor: p.color || '#CBD5E1',
          marginVertical: Number(p.margin) || 8
        }} />;
      case 'Spacer':
        return <View className={styles.spacer} style={{
          height: Number(p.height) || 16
        }}><Text className={styles.spacerText}>Spacer · {Number(p.height) || 16}</Text></View>;
      case 'WebView':
        return <View className={styles.embed} style={{
          height: Number(p.height) || 180
        }}><Icon name="globe-outline" size={30} color="#0E7490" /><Text className={styles.embedTitle}>Web</Text><Text className={styles.embedText} numberOfLines={1}>{p.url}</Text></View>;
      case 'Icon':
        return <View className={styles.iconPreview}><Icon name="star-outline" size={Number(p.size) || 28} color={p.tint || '#4F46E5'} /><Text className={styles.embedText}>{p.iconName || 'Favorite'}</Text></View>;
      default:
        return <View className={styles.unknown}><Icon name="cube-outline" size={16} color={colors.textSecondary} /><Text style={{
            color: colors.textSecondary
          }}>{component.type}</Text></View>;
    }
  };
  return <Pressable ref={viewRef} collapsable={false} onLayout={measure} onPress={event => {
    event.stopPropagation?.();
    onSelect?.(component.id);
  }} className={cn(styles.wrapper, container && styles.containerBoundary, selected && styles.selected, isDropTarget && styles.dropTarget)}>
      {selected ? <View className={styles.selectionTools}>
          <View className={styles.selectionName}><Text className={styles.selectionNameText}>{component.type}</Text></View>
          <Pressable onPress={event => {
        event.stopPropagation?.();
        onEdit?.(component.id);
      }} className={styles.selectionButton}>
            <Icon name="create-outline" size={12} color="#FFFFFF" />
          </Pressable>
          {depth > 0 ? <View {...dragResponder.panHandlers} className={styles.selectionButton}>
              <Icon name="move-outline" size={13} color="#FFFFFF" />
            </View> : null}
        </View> : null}
      {render()}
    </Pressable>;
};
const createStyles = c => ({
  wrapper: "relative border border-transparent rounded-[5px] my-[2px]",
  containerBoundary: "border-dashed border-[#94A3B866]",
  selected: "border-[2px] border-selection-border bg-selection",
  dropTarget: "border-[2px] border-success bg-success-bg",
  selectionTools: "absolute top-[-23px] left-[-2px] right-[-2px] z-[30] h-[22px] flex-row items-center justify-end gap-[3px]",
  selectionName: "h-[21px] max-w-[120px] mr-[auto] px-[6px] justify-center rounded-[4px] bg-primary",
  selectionNameText: "text-white text-[8px] font-bold font-mono",
  selectionButton: "w-[22px] h-[22px] rounded-[5px] items-center justify-center bg-primary",
  placeholder: "min-h-[38px] items-center justify-center flex-row gap-[4px]",
  placeholderText: "text-text-tertiary text-[9px]",
  containerPreview: "p-[8px] rounded-[6px]",
  card: "my-[4px] border border-[#D8DEE8] shadow-lg shadow-lg",
  elevatedCard: "my-[4px] border border-[#E2E8F0] rounded-[12px] shadow-lg shadow-lg bg-white",
  scaffoldTopBar: "h-[56px] px-[16px] flex-row items-center bg-[#4F46E5] shadow-lg shadow-lg",
  scaffoldTopBarTitle: "text-white text-[18px] font-bold",
  button: "min-h-[42px] items-center justify-center my-[4px] px-[16px]",
  outlinedButton: "min-h-[42px] items-center justify-center my-[4px] px-[16px] border border-[#4F46E5] bg-transparent",
  input: "min-h-[44px] justify-center my-[4px] border border-[#CBD5E1]",
  media: "items-center justify-center gap-[4px] my-[4px]",
  mediaLabel: "text-[#64748B] text-[10px]",
  row: "min-h-[40px] flex-row items-center gap-[9px] py-[5px]",
  switchTrack: "w-[44px] h-[24px] rounded-[12px] p-[3px] justify-center",
  switchKnob: "w-[18px] h-[18px] rounded-[9px] bg-white",
  progress: "w-full h-[8px] rounded-[4px] overflow-hidden bg-[#E2E8F0] my-[9px]",
  circular: "border-[5px] rounded-full border-t-transparent my-[6px]",
  iconPreview: "min-h-[52px] items-center justify-center gap-[3px]",
  spacer: "border border-[#94A3B8] justify-center",
  spacerText: "text-[#64748B] text-[8px] text-center",
  embed: "w-full bg-[#E8F1F5] rounded-[8px] items-center justify-center gap-[4px] my-[4px]",
  embedTitle: "text-[#334155] text-[12px] font-bold",
  embedText: "text-[#64748B] text-[9px] max-w-[80%]",
  unknown: "min-h-[38px] flex-row items-center justify-center gap-[7px] bg-bg-elevated"
});
export default WidgetRenderer;
