import { AlertTriangle, X } from 'lucide-react';

export interface DeliveryErrorDetail {
  message: string;
  code?: string;
  phase?: string;
  requestId?: string;
}

interface Props {
  error: DeliveryErrorDetail | string | null;
  onDismiss?: () => void;
}

/**
 * Renders the structured backend error envelope ({code, phase, requestId})
 * instead of a blank screen, so a failure is precise and debuggable. requestId
 * lets a user/dev correlate the error with the server log line (I2).
 */
export default function DeliveryErrorBanner({ error, onDismiss }: Props) {
  if (!error) return null;
  const detail: DeliveryErrorDetail = typeof error === 'string' ? { message: error } : error;
  return (
    <div className="delivery-error delivery-error--rich" role="alert">
      <AlertTriangle size={15} className="delivery-error__icon" />
      <div className="delivery-error__body">
        <div className="delivery-error__message">{detail.message}</div>
        <div className="delivery-error__meta">
          {detail.code && <span className="delivery-error__chip">code: {detail.code}</span>}
          {detail.phase && <span className="delivery-error__chip">phase: {detail.phase}</span>}
          {detail.requestId && (
            <span className="delivery-error__chip delivery-error__chip--req" title="Correlates with the server log line">
              requestId: {detail.requestId}
            </span>
          )}
        </div>
      </div>
      {onDismiss && (
        <button type="button" className="delivery-error__close" onClick={onDismiss} aria-label="Dismiss error">
          <X size={14} />
        </button>
      )}
    </div>
  );
}
