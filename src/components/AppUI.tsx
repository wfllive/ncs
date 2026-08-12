import React from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { useAppSettings } from '../store/appSettings';
import { cn } from '../utils/cn';

export const AppScreen = ({ children, style, className, safe = true }: any) => {
  const Component = safe ? SafeAreaView : View;
  return <Component className={cn('flex-1 bg-bg', className)} style={style}>{children}</Component>;
};

export const IconButton = ({ name, label, accessibilityLabel, onPress, disabled, active, danger, size = 20, style, className }: any) => {
  const { colors } = useAppSettings();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label || name}
      disabled={disabled}
      onPress={onPress}
      className={cn(
        'h-[42px] min-w-[42px] flex-row items-center justify-center gap-[7px] rounded-[10px] border px-3 active:opacity-70',
        !label && 'px-0',
        active ? 'border-primary bg-primary-surface' : danger ? 'border-error bg-bg-elevated' : 'border-border bg-bg-elevated',
        disabled && 'opacity-40',
        className,
      )}
      style={style}
    >
      <Icon name={name} size={size} color={danger ? colors.error : active ? colors.primary : colors.textSecondary} />
      {label ? <Text className={cn('text-[13px] font-semibold', danger ? 'text-error' : 'text-text')}>{label}</Text> : null}
    </Pressable>
  );
};

export const TopBar = ({ title, subtitle, onBack, left, right, compact = false }: any) => (
  <View className={cn(
    'flex-row items-center gap-2.5 border-b border-border bg-bg-card py-2',
    compact ? 'min-h-[58px] px-2.5' : 'min-h-[66px] px-4',
  )}>
    {onBack ? <IconButton name="arrow-back" onPress={onBack} accessibilityLabel="Back" className="min-w-[42px] px-0" /> : left}
    <View className="min-w-0 flex-1">
      <Text className={cn('font-bold text-text', compact ? 'text-base' : 'text-lg')} numberOfLines={1}>{title}</Text>
      {subtitle ? <Text className="mt-0.5 text-[11px] text-text-secondary" numberOfLines={1}>{subtitle}</Text> : null}
    </View>
    {right ? <View className="flex-row items-center gap-[7px]">{right}</View> : null}
  </View>
);

export const PrimaryButton = ({ title, icon, onPress, disabled, loading, destructive, style, className }: any) => (
  <Pressable
    accessibilityRole="button"
    disabled={disabled || loading}
    onPress={onPress}
    className={cn(
      'min-h-[46px] flex-row items-center justify-center gap-2 rounded-[11px] px-[18px] active:opacity-80',
      destructive ? 'bg-error' : 'bg-primary',
      disabled && 'opacity-45',
      className,
    )}
    style={style}
  >
    {loading ? <ActivityIndicator color="#FFFFFF" size="small" /> : icon ? <Icon name={icon} color="#FFFFFF" size={18} /> : null}
    <Text className="text-sm font-bold text-white">{title}</Text>
  </Pressable>
);

export const Field = ({ label, hint, style, className, inputClassName, ...props }: any) => {
  const { colors } = useAppSettings();
  return (
    <View className={cn('gap-1.5', className)} style={style}>
      {label ? <Text className="text-xs font-semibold text-text-secondary">{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.primary}
        {...props}
        className={cn('min-h-[46px] rounded-[10px] border border-border-light bg-bg-input px-[13px] py-2.5 text-sm text-text', inputClassName)}
      />
      {hint ? <Text className="text-[11px] leading-4 text-text-tertiary">{hint}</Text> : null}
    </View>
  );
};

export const SegmentedControl = ({ options, value, onChange, compact = false }: any) => (
  <View className="flex-row rounded-[11px] border border-border bg-bg-elevated p-[3px]">
    {options.map((option: any) => {
      const selected = option.value === value;
      return (
        <Pressable
          key={option.value}
          onPress={() => onChange(option.value)}
          className={cn(
            'flex-row items-center justify-center gap-1.5 rounded-lg px-2.5 active:opacity-70',
            option.flex === false ? '' : 'flex-1',
            compact ? 'min-h-[34px]' : 'min-h-[39px]',
            selected ? 'border border-border-light bg-bg-card' : 'border border-transparent',
          )}
        >
          <SegmentIcon option={option} selected={selected} />
          <Text numberOfLines={1} className={cn('text-xs', selected ? 'font-bold text-text' : 'font-medium text-text-secondary')}>
            {option.label}
          </Text>
        </Pressable>
      );
    })}
  </View>
);

const SegmentIcon = ({ option, selected }: any) => {
  const { colors } = useAppSettings();
  return option.icon ? <Icon name={option.icon} size={16} color={selected ? colors.primary : colors.textSecondary} /> : null;
};

export const SectionCard = ({ title, icon, children, style, className, right }: any) => {
  const { colors } = useAppSettings();
  return (
    <View className={cn('gap-3.5 rounded-[14px] border border-border bg-bg-card p-4', className)} style={style}>
      {title ? (
        <View className="flex-row items-center gap-[9px]">
          {icon ? <Icon name={icon} size={18} color={colors.primary} /> : null}
          <Text className="flex-1 text-[15px] font-bold text-text">{title}</Text>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
};

export const StatusPill = ({ label, tone = 'neutral' }: any) => {
  const tones: Record<string, string> = {
    success: 'bg-success-bg text-success-text',
    warning: 'bg-warning-bg text-warning-text',
    error: 'bg-error-bg text-error-text',
    info: 'bg-info-bg text-info-text',
    neutral: 'bg-bg-elevated text-text-secondary',
  };
  const [background, foreground] = (tones[tone] || tones.neutral).split(' ');
  return (
    <View className={cn('rounded-full px-[9px] py-1', background)}>
      <Text className={cn('text-[10px] font-bold', foreground)}>{label}</Text>
    </View>
  );
};
