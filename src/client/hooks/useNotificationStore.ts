import { useReducer, useCallback } from 'react';
import type { Notification } from '../../shared/notifications';

type Action =
  | { type: 'ADD'; item: Notification }
  | { type: 'UPDATE'; item: Notification }
  | { type: 'REMOVE'; id: string }
  | { type: 'MARK_READ'; id: string; readAt: string }
  | { type: 'MARK_ALL_READ'; readAt: string };

function reducer(state: Notification[], action: Action): Notification[] {
  switch (action.type) {
    case 'ADD':
      return [action.item, ...state.filter((n) => n.id !== action.item.id)];
    case 'UPDATE':
      return state.map((n) => (n.id === action.item.id ? action.item : n));
    case 'REMOVE':
      return state.filter((n) => n.id !== action.id);
    case 'MARK_READ':
      return state.map((n) => (n.id === action.id ? { ...n, readAt: action.readAt } : n));
    case 'MARK_ALL_READ':
      return state.map((n) => (n.readAt ? n : { ...n, readAt: action.readAt }));
    default:
      return state;
  }
}

export function useNotificationStore(initial: Notification[] = []) {
  const [items, dispatch] = useReducer(reducer, initial);

  const addOne = useCallback((item: Notification) => dispatch({ type: 'ADD', item }), []);
  const updateOne = useCallback((item: Notification) => dispatch({ type: 'UPDATE', item }), []);
  const removeOne = useCallback(
    (id: string) => {
      dispatch({ type: 'REMOVE', id });
      fetch(`/api/notifications/${id}`, { method: 'DELETE' }).catch(() => {});
    },
    [],
  );

  const markRead = useCallback((id: string) => {
    const readAt = new Date().toISOString();
    dispatch({ type: 'MARK_READ', id, readAt });
    fetch(`/api/notifications/${id}/read`, { method: 'PATCH' }).catch(() => {});
  }, []);

  const markAllRead = useCallback(() => {
    const readAt = new Date().toISOString();
    dispatch({ type: 'MARK_ALL_READ', readAt });
    fetch('/api/notifications/read-all', { method: 'POST' }).catch(() => {});
  }, []);

  const removeLocal = useCallback((id: string) => {
    dispatch({ type: 'REMOVE', id });
  }, []);

  const unreadCount = items.filter((n) => !n.readAt).length;

  return { items, addOne, updateOne, removeOne, removeLocal, markRead, markAllRead, unreadCount };
}
