import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from "react";
import { AlertDialog as RadixAlertDialog, Dialog as RadixDialog, RadioGroup as RadixRadioGroup,
  Tabs as RadixTabs, ToggleGroup as RadixToggleGroup, Tooltip as RadixTooltip } from "radix-ui";
import type { ButtonProps } from "./index.js";

const DialogContent = forwardRef<ComponentRef<typeof RadixDialog.Content>, ComponentPropsWithoutRef<typeof RadixDialog.Content>>(
  function DialogContent({ className = "", ...props }, ref) {
    return <RadixDialog.Content {...props} ref={ref} className={`dialog-content ${className}`.trim()} />;
  });
const DialogOverlay = forwardRef<ComponentRef<typeof RadixDialog.Overlay>, ComponentPropsWithoutRef<typeof RadixDialog.Overlay>>(
  function DialogOverlay({ className = "", ...props }, ref) {
    return <RadixDialog.Overlay {...props} ref={ref} className={`dialog-overlay ${className}`.trim()} />;
  });
export const DialogParts = { ...RadixDialog, Content: DialogContent, Overlay: DialogOverlay };

const AlertContent = forwardRef<ComponentRef<typeof RadixAlertDialog.Content>, ComponentPropsWithoutRef<typeof RadixAlertDialog.Content>>(
  function AlertContent({ className = "", ...props }, ref) {
    return <RadixAlertDialog.Content {...props} ref={ref} className={`dialog-content ${className}`.trim()} />;
  });
const AlertOverlay = forwardRef<ComponentRef<typeof RadixAlertDialog.Overlay>, ComponentPropsWithoutRef<typeof RadixAlertDialog.Overlay>>(
  function AlertOverlay({ className = "", ...props }, ref) {
    return <RadixAlertDialog.Overlay {...props} ref={ref} className={`dialog-overlay ${className}`.trim()} />;
  });
const AlertAction = forwardRef<ComponentRef<typeof RadixAlertDialog.Action>,
  ComponentPropsWithoutRef<typeof RadixAlertDialog.Action> & Pick<ButtonProps, "variant">>(
  function AlertAction({ className = "", variant = "primary", ...props }, ref) {
    return <RadixAlertDialog.Action {...props} ref={ref} className={`tandem-button ${className}`.trim()}
      data-ui="button" data-variant={variant} data-size="medium" />;
  });
const AlertCancel = forwardRef<ComponentRef<typeof RadixAlertDialog.Cancel>, ComponentPropsWithoutRef<typeof RadixAlertDialog.Cancel>>(
  function AlertCancel({ className = "", ...props }, ref) {
    return <RadixAlertDialog.Cancel {...props} ref={ref} className={`tandem-button ${className}`.trim()}
      data-ui="button" data-variant="secondary" data-size="medium" />;
  });
export const AlertDialog = { ...RadixAlertDialog, Content: AlertContent, Overlay: AlertOverlay, Action: AlertAction, Cancel: AlertCancel };

const Tab = forwardRef<ComponentRef<typeof RadixTabs.Trigger>, ComponentPropsWithoutRef<typeof RadixTabs.Trigger>>(
  function Tab({ className = "", ...props }, ref) {
    return <RadixTabs.Trigger {...props} ref={ref} data-ui="tab" className={`tandem-tab ${className}`.trim()} />;
  });
export const Tabs = { ...RadixTabs, Trigger: Tab };

const Toggle = forwardRef<ComponentRef<typeof RadixToggleGroup.Item>,
  ComponentPropsWithoutRef<typeof RadixToggleGroup.Item> & { iconOnly?: boolean }>(
  function Toggle({ className = "", iconOnly = false, ...props }, ref) {
    return <RadixToggleGroup.Item {...props} ref={ref} data-ui="toggle"
      className={`tandem-toggle${iconOnly ? " tandem-icon-button" : ""} ${className}`.trim()} />;
  });
export const ToggleGroup = { ...RadixToggleGroup, Item: Toggle };

const Radio = forwardRef<ComponentRef<typeof RadixRadioGroup.Item>,
  ComponentPropsWithoutRef<typeof RadixRadioGroup.Item> & { presentation?: "control" | "choice" }>(
  function Radio({ className = "", presentation = "control", ...props }, ref) {
    return <RadixRadioGroup.Item {...props} ref={ref} data-ui="radio" data-presentation={presentation}
      className={`tandem-radio ${className}`.trim()} />;
  });
const RadioIndicator = forwardRef<ComponentRef<typeof RadixRadioGroup.Indicator>, ComponentPropsWithoutRef<typeof RadixRadioGroup.Indicator>>(
  function RadioIndicator({ className = "", ...props }, ref) {
    return <RadixRadioGroup.Indicator {...props} ref={ref} className={`tandem-radio-indicator ${className}`.trim()} />;
  });
export const RadioGroup = { ...RadixRadioGroup, Item: Radio, Indicator: RadioIndicator };

const TooltipContent = forwardRef<ComponentRef<typeof RadixTooltip.Content>, ComponentPropsWithoutRef<typeof RadixTooltip.Content>>(
  function TooltipContent({ className = "", sideOffset = 6, ...props }, ref) {
    return <RadixTooltip.Content {...props} ref={ref} sideOffset={sideOffset} data-ui="tooltip"
      className={`tandem-tooltip ${className}`.trim()} />;
  });
export const Tooltip = { ...RadixTooltip, Content: TooltipContent };
