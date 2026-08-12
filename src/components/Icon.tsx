import React from 'react';
import { Ionicons, MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { StyleProp, TextStyle } from 'react-native';

export interface IconProps {
  name: string;
  size?: number;
  color?: string;
  type?: 'ionicons' | 'material' | 'community';
  style?: StyleProp<TextStyle>;
}

/** A small, consistently typed adapter around the three icon families used by the app. */
export const Icon = ({ name, size = 20, color = '#111827', type = 'ionicons', style }: IconProps) => {
  const props = { name, size, color, style };
  if (type === 'material') return <MaterialIcons {...props as React.ComponentProps<typeof MaterialIcons>} />;
  if (type === 'community') return <MaterialCommunityIcons {...props as React.ComponentProps<typeof MaterialCommunityIcons>} />;
  return <Ionicons {...props as React.ComponentProps<typeof Ionicons>} />;
};

export const componentIcons = {
  Column: { name: 'reorder-four-outline', color: '#7C3AED' },
  Row: { name: 'reorder-three-outline', color: '#7C3AED' },
  Box: { name: 'square-outline', color: '#7C3AED' },
  LazyColumn: { name: 'list-outline', color: '#7C3AED' },
  Card: { name: 'card-outline', color: '#7C3AED' },
  ElevatedCard: { name: 'card-outline', color: '#7C3AED' },
  Scaffold: { name: 'layers-outline', color: '#7C3AED' },
  TopAppBar: { name: 'chevron-down-outline', color: '#2563EB' },
  Text: { name: 'text-outline', color: '#2563EB' },
  Button: { name: 'radio-button-on-outline', color: '#2563EB' },
  OutlinedButton: { name: 'square-outline', color: '#2563EB' },
  OutlinedTextField: { name: 'create-outline', color: '#EA580C' },
  Image: { name: 'image-outline', color: '#0891B2' },
  Checkbox: { name: 'checkbox-outline', color: '#EA580C' },
  Switch: { name: 'toggle-outline', color: '#EA580C' },
  LinearProgressIndicator: { name: 'remove-outline', color: '#2563EB' },
  CircularProgressIndicator: { name: 'sync-outline', color: '#2563EB' },
  HorizontalDivider: { name: 'remove-outline', color: '#64748B' },
  Spacer: { name: 'expand-outline', color: '#64748B' },
  Icon: { name: 'star-outline', color: '#0891B2' },
  WebView: { name: 'globe-outline', color: '#0891B2' },
} as const;

export default Icon;
