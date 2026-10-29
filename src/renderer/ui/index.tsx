import { forwardRef, useId, useMemo, useState, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ComponentPropsWithoutRef, type HTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactElement, type ReactNode } from "react";
import { Dialog as RadixDialog } from "radix-ui";
import { CircleAlert, CircleCheck, CircleX, Info, LoaderCircle } from "lucide-react";
import { createComposerEnterHandlers } from "../../../development/tandem/public/composer-enter.js";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "item";
  size?: "small" | "medium" | "large";
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = "secondary", size = "medium", type = "button", loading = false,
  disabled, className = "", children, ...props
}, ref) {
  return <button {...props} ref={ref} type={type} disabled={disabled || loading}
    aria-busy={loading || props["aria-busy"]}
    className={`tandem-button ${className}`.trim()} data-ui="button" data-variant={variant} data-size={size}>
    {loading && <LoaderCircle className="tandem-spin" size={16} aria-hidden="true" />}
    {children}
  </button>;
});

export interface ActionLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  iconOnly?: boolean;
}

export const ActionLink = forwardRef<HTMLAnchorElement, ActionLinkProps>(function ActionLink({
  variant = "secondary", size = "medium", iconOnly = false, className = "", ...props
}, ref) {
  return <a {...props} ref={ref} data-ui="button" data-variant={variant} data-size={size}
    className={`tandem-button${iconOnly ? " tandem-icon-button" : ""} ${className}`.trim()} />;
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({
  className = "", ...props
}, ref) {
  return <input {...props} ref={ref} data-ui="input" className={`tandem-input ${className}`.trim()} />;
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  submitOnEnter?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({
  className = "", submitOnEnter = false, onKeyDown, onKeyUp, onFocus, onBlur, onCompositionStart, onCompositionEnd, ...props
}, ref) {
  const [expanded, setExpanded] = useState(false);
  const enter = useMemo(() => createComposerEnterHandlers(textarea => {
    const form = textarea.form;
    if (!form) return;
    const submitter = Array.from(form.elements).find((element): element is HTMLButtonElement | HTMLInputElement =>
      element.matches('button[type="submit"], button:not([type]), input[type="submit"]'));
    if (submitter && !submitter.matches(":disabled")) form.requestSubmit(submitter);
  }), []);
  return <textarea {...props} ref={ref} data-ui="input" className={`tandem-input ${className}`.trim()}
    data-composer-expanded={expanded || undefined}
    title={props.title ?? (submitOnEnter ? "Enter to send; Ctrl+Enter for a new line." : undefined)}
    aria-keyshortcuts={props["aria-keyshortcuts"] ?? (submitOnEnter ? "Enter" : undefined)}
    onFocus={event => { setExpanded(true); onFocus?.(event); }}
    onKeyDown={event => {
      onKeyDown?.(event);
      if (submitOnEnter) enter.keydown(event.nativeEvent, event.currentTarget);
    }}
    onKeyUp={event => { onKeyUp?.(event); enter.keyup(event); }}
    onBlur={event => { onBlur?.(event); enter.blur(); }}
    onCompositionStart={event => { onCompositionStart?.(event); enter.compositionstart(); }}
    onCompositionEnd={event => { onCompositionEnd?.(event); enter.compositionend(); }} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({
  className = "", ...props
}, ref) {
  return <select {...props} ref={ref} data-ui="input" className={`tandem-input ${className}`.trim()} />;
});

export const NativeDialog = forwardRef<HTMLDialogElement, ComponentPropsWithoutRef<"dialog">>(function NativeDialog({
  className = "", ...props
}, ref) {
  return <dialog {...props} ref={ref} className={`tandem-native-dialog ${className}`.trim()} />;
});

export const Disclosure = forwardRef<HTMLDetailsElement, ComponentPropsWithoutRef<"details">>(function Disclosure({
  className = "", ...props
}, ref) {
  return <details {...props} ref={ref} className={`tandem-disclosure ${className}`.trim()} />;
});

export interface IconButtonProps extends ButtonProps {
  "aria-label": string;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  className = "", children, loading, ...props
}, ref) {
  return <Button {...props} ref={ref} loading={loading} className={`tandem-icon-button ${className}`.trim()}>
    {loading ? null : children}
  </Button>;
});

export interface FieldControlProps {
  id: string;
  className: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

export interface FormFieldProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  label: ReactNode;
  description?: ReactNode;
  error?: string;
  children(control: FieldControlProps): ReactNode;
}

export function FormField({ id, label, description, error, children, className = "", ...props }: FormFieldProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const helpId = description ? `${controlId}-help` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  return <div {...props} className={`tandem-field ${className}`.trim()}>
    <label htmlFor={controlId}>{label}</label>
    {children({
      id: controlId, className: "tandem-input",
      "aria-describedby": [helpId, errorId].filter(Boolean).join(" ") || undefined,
      "aria-invalid": error ? true : undefined,
    })}
    {description && <p id={helpId} className="tandem-field-description">{description}</p>}
    {error && <p id={errorId} className="tandem-field-error" role="alert">{error}</p>}
  </div>;
}

export interface DialogProps extends Omit<ComponentPropsWithoutRef<typeof RadixDialog.Content>, "title" | "children" | "aria-labelledby" | "aria-describedby"> {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: ReactNode;
  description: ReactNode;
  trigger?: ReactElement;
  footer?: ReactNode;
  children: ReactNode;
}

export function Dialog({ open, onOpenChange, title, description, trigger, footer, children, className = "", ...props }: DialogProps) {
  return <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
    {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="dialog-overlay" />
      <RadixDialog.Content {...props} className={`dialog-content ${className}`.trim()}>
        <RadixDialog.Title>{title}</RadixDialog.Title>
        <RadixDialog.Description>{description}</RadixDialog.Description>
        {children}
        {footer && <div className="dialog-actions">{footer}</div>}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  </RadixDialog.Root>;
}

const statusIcons = { info: Info, success: CircleCheck, warning: CircleAlert, danger: CircleX };

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | keyof typeof statusIcons;
}

export function Badge({ tone = "neutral", className = "", ...props }: BadgeProps) {
  return <span {...props} className={`tandem-badge ${className}`.trim()} data-tone={tone} />;
}

export interface StatusProps extends HTMLAttributes<HTMLParagraphElement> {
  tone?: keyof typeof statusIcons;
  busy?: boolean;
  children: ReactNode;
}

export function Status({ tone = "info", busy = false, className = "", children, ...props }: StatusProps) {
  const Icon = busy ? LoaderCircle : statusIcons[tone];
  return <p {...props} className={`tandem-status ${className}`.trim()} data-tone={tone}>
    <Icon size={16} aria-hidden="true" className={busy ? "tandem-spin" : undefined} />
    <span>{children}</span>
  </p>;
}

export { AlertDialog, DialogParts, RadioGroup, Tabs, ToggleGroup, Tooltip } from "./radix.js";
