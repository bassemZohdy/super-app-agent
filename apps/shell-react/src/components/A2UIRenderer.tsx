import { choiceDefaults, surfaceActionPayload } from '../../../../packages/protocol-core/src/surface-client.ts';
import React, { useState, useEffect, useContext, createContext } from 'react';
import type { UIComponentNode } from '../../../../packages/protocol-core/src/index.ts';

interface SurfaceFormState {
  choices: Record<string, string>;
  setChoice: (group: string, choice: string) => void;
  view?: UIComponentNode;
  formValues: Record<string, any>;
  setFormValue: (key: string, value: any) => void;
  submittingAction: string | null;
  setSubmittingAction: (action: string | null) => void;
  isPending?: boolean;
}

const SurfaceFormContext = createContext<SurfaceFormState>({
  choices: {},
  setChoice: () => {},
  formValues: {},
  setFormValue: () => {},
  submittingAction: null,
  setSubmittingAction: () => {},
  isPending: false,
});

interface A2UIRendererProps {
  node: UIComponentNode;
  onDispatchAction: (action: string, payload: Record<string, any>) => void;
  isPending?: boolean;
}

function SurfaceCardWrapper({
  node,
  onDispatchAction,
  isPending,
}: {
  node: UIComponentNode;
  onDispatchAction: (action: string, payload: Record<string, any>) => void;
  isPending?: boolean;
}) {
  const [choices, setChoices] = useState(() => choiceDefaults(node));
  const setChoice = (group: string, choice: string) => setChoices(prev => ({ ...prev, [group]: choice }));
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending) {
      setSubmittingAction(null);
    }
  }, [isPending]);

  const setFormValue = (key: string, value: any) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const isSuccess = node.style?.variant === 'success';
  const isWarning = node.style?.variant === 'warning';
  const borderColor = isSuccess ? '#bbf7d0' : isWarning ? '#fde68a' : '#e2e8f0';
  const bgColor = isSuccess ? '#f0fdf4' : isWarning ? '#fffbeb' : '#ffffff';

  return (
    <SurfaceFormContext.Provider
      value={{ choices, setChoice, view: node, formValues, setFormValue, submittingAction, setSubmittingAction, isPending }}
    >
      <div
        className="ag-surface-card"
        id={node.id}
        style={{
          background: bgColor,
          border: `1px solid ${borderColor}`,
          borderRadius: '16px',
          padding:
            node.style?.padding === 'large'
              ? '28px'
              : node.style?.padding === 'small'
              ? '12px'
              : '20px',
          boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.05)',
          marginBottom: '16px',
        }}
      >
        {node.children?.map((child) => (
          <A2UIRenderer key={child.id} node={child} onDispatchAction={onDispatchAction} isPending={isPending} />
        ))}
      </div>
    </SurfaceFormContext.Provider>
  );
}

export const A2UIRenderer: React.FC<A2UIRendererProps> = ({ node, onDispatchAction, isPending }) => {
  const { choices, setChoice, view, formValues, setFormValue, submittingAction, setSubmittingAction } =
    useContext(SurfaceFormContext);

  switch (node.type) {
    case 'SurfaceCard':
      return <SurfaceCardWrapper node={node} onDispatchAction={onDispatchAction} isPending={isPending} />;

    case 'Heading': {
      const level = node.properties?.level || 2;
      const fontSize = level === 1 ? '24px' : level === 2 ? '18px' : '16px';
      return (
        <h2 style={{ fontSize, fontWeight: 700, color: '#0f172a', marginBottom: '12px' }}>
          {node.properties?.text}
        </h2>
      );
    }

    case 'Text': {
      return (
        <p
          style={{
            color: node.properties?.muted ? '#64748b' : '#334155',
            fontSize: '14px',
            lineHeight: '1.6',
            marginBottom: '12px',
          }}
        >
          {node.properties?.text}
        </p>
      );
    }

    case 'Badge': {
      const variant = node.properties?.variant || 'primary';
      const styles =
        {
          primary: { bg: '#dbeafe', color: '#1e40af' },
          secondary: { bg: '#f1f5f9', color: '#475569' },
          success: { bg: '#dcfce7', color: '#166534' },
          warning: { bg: '#fef3c7', color: '#92400e' },
          danger: { bg: '#fee2e2', color: '#991b1b' },
        }[variant as 'primary'] || { bg: '#dbeafe', color: '#1e40af' };

      return (
        <span
          style={{
            display: 'inline-block',
            padding: '3px 8px',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: 700,
            background: styles.bg,
            color: styles.color,
            marginRight: '6px',
            marginBottom: '6px',
          }}
        >
          {node.properties?.text}
        </span>
      );
    }

    case 'ChoiceGroup': {
      const options = node.properties?.options || [];
      const currentSelected = choices[node.id];

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
          {options.map((opt: any) => {
            const isSelected = currentSelected === opt.id;
            return (
              <div
                key={opt.id}
                role="radio"
                aria-checked={isSelected}
                tabIndex={0}
                className={`ag-choice-item ${isSelected ? 'selected' : ''}`}
                onClick={() => setChoice(node.id, opt.id)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    setChoice(node.id, opt.id);
                  }
                }}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '13px 16px',
                  borderRadius: '12px',
                  border: isSelected ? '2px solid #059669' : '1.5px solid #e2e8f0',
                  background: isSelected ? '#ecfdf5' : '#ffffff',
                  cursor: 'pointer',
                  transition: 'all 0.18s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {/* Visual Radio Circle */}
                  <div
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      border: isSelected ? '6px solid #059669' : '2px solid #cbd5e1',
                      background: '#ffffff',
                      flexShrink: 0,
                      transition: 'all 0.15s ease',
                      boxShadow: isSelected ? '0 0 0 2px rgba(5, 150, 105, 0.25)' : 'none',
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px', color: '#0f172a' }}>
                      {opt.title}
                    </div>
                    {opt.subtitle && (
                      <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                        {opt.subtitle}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                  {opt.price && (
                    <div style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a' }}>
                      {opt.price}
                    </div>
                  )}
                  {opt.badge && (
                    <span
                      style={{
                        fontSize: '11px',
                        background: '#e0e7ff',
                        color: '#4338ca',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontWeight: 600,
                        display: 'inline-block',
                      }}
                    >
                      {opt.badge}
                    </span>
                  )}
                  {isSelected && (
                    <span
                      style={{
                        fontSize: '10px',
                        background: '#dcfce7',
                        color: '#166534',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        fontWeight: 700,
                      }}
                    >
                      ✓ Selected
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    case 'MetricWidget': {
      const onPressEvent = node.onEvents?.find((e) => e.event === 'onPress');
      const isInteractive = !!onPressEvent;

      return (
        <div
          className={isInteractive ? 'ag-interactive-widget' : ''}
          onClick={() => {
            if (onPressEvent) {
              if (onPressEvent.actionType === 'LAUNCH_MINIAPP') {
                onDispatchAction('LAUNCH_MINIAPP', onPressEvent.payload);
              } else {
                onDispatchAction(onPressEvent.payload.action || 'submit', onPressEvent.payload);
              }
            }
          }}
          style={{
            background: isInteractive ? '#ffffff' : '#f8fafc',
            border: isInteractive ? '1.5px solid #a7f3d0' : '1px solid #e2e8f0',
            padding: '14px 18px',
            borderRadius: '12px',
            marginBottom: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: isInteractive ? 'pointer' : 'default',
            transition: 'all 0.18s ease',
          }}
        >
          <div>
            <div
              style={{
                color: isInteractive ? '#065f46' : '#64748b',
                fontSize: '12px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {node.properties?.label}
              {isInteractive && (
                <span style={{ fontSize: '10px', background: '#ecfdf5', color: '#047857', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>
                  TAP TO OPEN ↗
                </span>
              )}
            </div>
            {node.properties?.subtext && (
              <div style={{ color: '#94a3b8', fontSize: '11px', marginTop: '2px' }}>
                {node.properties?.subtext}
              </div>
            )}
          </div>
          <div style={{ fontWeight: 800, fontSize: '17px', color: '#0f172a' }}>
            {node.properties?.value}
          </div>
        </div>
      );
    }

    case 'MapViewer': {
      const markers = node.properties?.markers || [];
      return (
        <div
          style={{
            background: '#e2e8f0',
            border: '1px solid #cbd5e1',
            borderRadius: '12px',
            height: '180px',
            marginBottom: '16px',
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          {/* Simulated Map Grid Canvas */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: 'radial-gradient(#94a3b8 1.5px, transparent 1.5px)',
              backgroundSize: '24px 24px',
              opacity: 0.5,
            }}
          />
          {/* Simulated Route Polyline */}
          <svg
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
            }}
          >
            <path
              d="M 60,130 Q 200,40 340,110 T 520,70"
              fill="none"
              stroke="#059669"
              strokeWidth="4"
              strokeDasharray="6 4"
            />
          </svg>
          <div style={{ zIndex: 1, display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '10px', justifyContent: 'center' }}>
            {markers.map((m: any, i: number) => (
              <div
                key={m.id || i}
                style={{
                  background: '#ffffff',
                  padding: '6px 12px',
                  borderRadius: '20px',
                  boxShadow: '0 4px 8px rgba(0,0,0,0.1)',
                  fontWeight: 700,
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: '#0f172a',
                }}
              >
                <span>📍</span>
                <span>{m.title || `Location ${i + 1}`}</span>
              </div>
            ))}
          </div>
          <div
            style={{
              position: 'absolute',
              bottom: '8px',
              right: '12px',
              fontSize: '10px',
              color: '#065f46',
              background: 'rgba(255,255,255,0.9)',
              padding: '2px 6px',
              borderRadius: '4px',
              fontWeight: 600,
            }}
          >
            Live GPS Telemetry (Dubai / Abu Dhabi)
          </div>
        </div>
      );
    }

    case 'DataTable': {
      const columns = node.properties?.columns || [];
      const rows = node.properties?.rows || [];

      return (
        <div
          style={{
            overflowX: 'auto',
            marginBottom: '16px',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '13px',
              textAlign: 'left',
            }}
          >
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                {columns.map((col: any) => (
                  <th
                    key={col.key}
                    style={{ padding: '10px 14px', color: '#64748b', fontWeight: 600 }}
                  >
                    {col.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any, rIdx: number) => (
                <tr
                  key={rIdx}
                  style={{
                    borderBottom: rIdx < rows.length - 1 ? '1px solid #f1f5f9' : 'none',
                  }}
                >
                  {columns.map((col: any) => (
                    <td key={col.key} style={{ padding: '10px 14px', color: '#1e293b' }}>
                      {row[col.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case 'FormInput': {
      const inputName = node.properties?.name || 'input';
      const curVal = formValues[inputName] ?? (node.properties?.defaultValue || '');

      return (
        <div style={{ marginBottom: '14px' }}>
          {node.properties?.label && (
            <label
              style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: 600,
                color: '#334155',
                marginBottom: '4px',
              }}
            >
              {node.properties.label}
            </label>
          )}
          <input
            type={node.properties?.inputType || 'text'}
            placeholder={node.properties?.placeholder}
            value={curVal}
            onChange={(e) => setFormValue(inputName, e.target.value)}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '14px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      );
    }

    case 'MiniAppEmbed': {
      return (
        <div
          style={{
            border: '2px solid #059669',
            borderRadius: '12px',
            padding: '20px',
            background: '#f0fdf4',
            marginBottom: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '18px' }}>🏛️</span>
            <strong style={{ fontSize: '14px' }}>
              Smart City Microfrontend: {node.properties?.miniAppId}
            </strong>
          </div>
          <p style={{ fontSize: '12px', color: '#64748b' }}>
            Route: {node.properties?.entryRoute || '/'} • Scoped Sandbox Container
          </p>
        </div>
      );
    }

    case 'Button': {
      const variant = node.properties?.variant || 'primary';
      const isOutline = variant === 'outline';
      const bg = isOutline ? '#ffffff' : '#059669';
      const textCol = isOutline ? '#059669' : '#ffffff';
      const border = isOutline ? '1.5px solid #059669' : 'none';

      const eventBinding = node.onEvents?.find((e) => e.event === 'onPress');
      const actionKey = eventBinding?.payload?.action || eventBinding?.actionType || 'action';
      const isSubmitting = submittingAction === actionKey || isPending;

      return (
        <button
          type="button"
          className="ag-btn"
          disabled={node.properties?.disabled === true || isSubmitting}
          onClick={() => {
            if (isSubmitting) return;
            if (eventBinding) {
              if (eventBinding.actionType === 'LAUNCH_MINIAPP') {
                onDispatchAction('LAUNCH_MINIAPP', eventBinding.payload);
              } else {
                const action = eventBinding.payload.action || 'submit';
                setSubmittingAction(action);
                try {
                  if (!view) throw new Error('No active surface.');
                  const payload = surfaceActionPayload(view, eventBinding, choices, formValues);
                  onDispatchAction(action, payload);
                } catch (error) {
                  setSubmittingAction(null);
                  onDispatchAction('CLIENT_ERROR', { error: (error as Error).message });
                }
              }
            }
          }}
          style={{
            width: node.properties?.fullWidth ? '100%' : 'auto',
            padding: '13px 20px',
            borderRadius: '12px',
            fontWeight: 700,
            fontSize: '14.5px',
            background: bg,
            color: textCol,
            border,
            boxShadow: isOutline ? 'none' : '0 2px 6px rgba(5, 150, 105, 0.25)',
          }}
        >
          {isSubmitting ? (
            <>
              <span className="spin-loader">⏳</span>
              <span>Processing with Smart City Grid...</span>
            </>
          ) : (
            node.properties?.label
          )}
        </button>
      );
    }

    default:
      return (
        <div style={{ color: '#ef4444', fontSize: '12px' }}>
          Unsupported component: {node.type}
        </div>
      );
  }
};

