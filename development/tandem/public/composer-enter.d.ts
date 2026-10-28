export interface ComposerEnterHandlers {
  compositionstart(): void;
  compositionend(): void;
  keyup(event: Pick<KeyboardEvent, "key">): void;
  blur(): void;
  keydown(event: KeyboardEvent, textarea: HTMLTextAreaElement): void;
}

export function createComposerEnterHandlers(submit: (textarea: HTMLTextAreaElement) => void): ComposerEnterHandlers;
export function installComposerEnter(textarea: HTMLTextAreaElement, form: HTMLFormElement, canSend: () => boolean): () => void;
