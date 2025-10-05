import React, { createContext, useContext, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';

interface ToastOptions {
  title: string;
  description?: string;
  status: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
  isClosable?: boolean;
}

interface ToastContextType {
  toast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

interface ToastProps extends ToastOptions {
  id: string;
  onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({ id: _id, title, description, status, onClose, duration = 5000, isClosable = true }) => {
  const [isVisible, setIsVisible] = useState(true);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      onClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const handleClose = () => {
    setIsVisible(false);
    onClose();
  };

  if (!isVisible) return null;

  const bgColor = status === 'success' ? 'bg-green-500' : status === 'error' ? 'bg-red-500' : status === 'info' ? 'bg-blue-500' : 'bg-yellow-500';

  return (
    <div className={`relative p-4 mb-2 text-white rounded shadow-lg ${bgColor}`}>
      <div className="font-bold">{title}</div>
      {description && <div className="text-sm">{description}</div>}
      {isClosable && (
        <button className="absolute top-1 right-1 text-white text-lg" onClick={handleClose}>
          &times;
        </button>
      )}
    </div>
  );
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastProps[]>([]);

  const toast = useCallback((options: ToastOptions) => {
    const id = Date.now().toString();
    setToasts(prevToasts => [...prevToasts, { ...options, id, onClose: () => setToasts(t => t.filter(toast => toast.id !== id)) }]);
  }, []);

  const portalElement = document.getElementById('toast-portal');
  if (!portalElement) {
    // Create portal element if it doesn't exist
    const newPortalElement = document.createElement('div');
    newPortalElement.id = 'toast-portal';
    document.body.appendChild(newPortalElement);
  }

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {ReactDOM.createPortal(
        <div className="fixed top-4 right-4 z-50">
          {toasts.map(t => (
            <Toast key={t.id} {...t} />
          ))}
        </div>,
        document.getElementById('toast-portal') || document.body // Fallback to document.body
      )}
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context.toast;
};