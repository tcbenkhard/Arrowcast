import { useEffect, useRef } from 'react';

export function useModal(onClose: () => void, pending: boolean) {
  const dialog = useRef<HTMLDialogElement>(null);
  const state = useRef({ onClose, pending });
  state.current = { onClose, pending };
  useEffect(() => {
    const element = dialog.current!;
    let startedOutside = false;
    const outside = (event: MouseEvent) => {
      const rect = element.getBoundingClientRect();
      return event.target === element && (event.clientX < rect.left || event.clientX > rect.right
        || event.clientY < rect.top || event.clientY > rect.bottom);
    };
    const pointerDown = (event: PointerEvent) => { startedOutside = outside(event); };
    const click = (event: MouseEvent) => {
      if (startedOutside && outside(event) && !state.current.pending) state.current.onClose();
      startedOutside = false;
    };
    const cancel = (event: Event) => {
      event.preventDefault();
      if (!state.current.pending) state.current.onClose();
    };
    element.addEventListener('pointerdown', pointerDown);
    element.addEventListener('click', click);
    element.addEventListener('cancel', cancel);
    element.showModal();
    return () => {
      element.removeEventListener('pointerdown', pointerDown);
      element.removeEventListener('click', click);
      element.removeEventListener('cancel', cancel);
      element.close();
    };
  }, []);
  return dialog;
}
