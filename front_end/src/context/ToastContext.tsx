import React, { createContext, useContext, useState, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';

export interface Toast {
  id: string;
  type: 'success' | 'warning' | 'error' | 'info';
  message: string;
}

interface ToastContextType {
  showToast: (message: string, type?: Toast['type']) => void;
  toasts: Toast[];
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = (message: string, type: Toast['type'] = 'info') => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  };

  return (
    <ToastContext.Provider value={{ showToast, toasts }}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.9 }}
              className="p-3 rounded border flex items-start gap-2.5 backdrop-blur-md pointer-events-auto"
              style={{
                backgroundColor: 'var(--ui-panel-strong)',
                borderColor: toast.type === 'success' ? 'var(--ui-positive)' :
                             toast.type === 'error' ? 'var(--ui-negative)' :
                             toast.type === 'warning' ? 'var(--ui-warning)' : 'var(--ui-accent)',
                color: 'var(--ui-text)',
                boxShadow: 'var(--ui-shadow)'
              }}
            >
              {toast.type === 'success' && <CheckCircle2 size={16} className="text-[var(--ui-positive)] shrink-0 mt-0.5" />}
              {toast.type === 'error' && <XCircle size={16} className="text-[var(--ui-negative)] shrink-0 mt-0.5" />}
              {toast.type === 'warning' && <AlertTriangle size={16} className="text-[var(--ui-warning)] shrink-0 mt-0.5" />}
              {toast.type === 'info' && <Info size={16} className="text-[var(--ui-accent)] shrink-0 mt-0.5" />}
              <span className="text-xs font-medium font-sans leading-relaxed">{toast.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
