import { choiceDefaults, surfaceActionPayload } from '../../../../packages/protocol-core/src/surface-client.ts';
import React, { useState, useEffect, useContext, createContext } from 'react';
import type { UIComponentNode } from '../../../../packages/protocol-core/src/index.ts';

interface SurfaceFormState {
  choices: Record<string, string>;
  setChoice: (group: string, choice: string) => void;
  view?: UIComponentNode;
  formValues: Record<string, unknown>;
  setFormValue: (key: string, value: unknown) => void;
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
  onDispatchAction: (action: string, payload: Record<string, unknown>) => void;
  isPending?: boolean;
}

function SurfaceCardWrapper({
  node,
  onDispatchAction,
  isPending,
}: {
  node: UIComponentNode;
  onDispatchAction: (action: string, payload: Record<string, unknown>) => void;
  isPending?: boolean;
}) {
  const [choices, setChoices] = useState(() => choiceDefaults(node));
  const setChoice = (group: string, choice: string) => setChoices(prev => ({ ...prev, [group]: choice }));
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending) {
      setSubmittingAction(null);
    }
  }, [isPending]);

  const setFormValue = (key: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const isSuccess = node.style?.variant === 'success';
  const isWarning = node.style?.variant === 'warning';
  const borderColor = isSuccess ? 'var(--primitive-color-green-92)' : isWarning ? 'var(--primitive-color-yellow-91)' : 'var(--primitive-color-slate-200)';
  const bgColor = isSuccess ? 'var(--primitive-color-slate-50)' : isWarning ? 'var(--primitive-color-yellow-96)' : 'var(--primitive-color-white)';

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
          boxShadow: '0 4px 12px -2px color-mix(in srgb, var(--primitive-color-slate-900) 5%, transparent)',
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

/** Dispatch name for an event: the payload's `action` when it is a non-empty string, otherwise 'submit'. */
const actionNameOf = (payload: Record<string, unknown>): string =>
  typeof payload.action === 'string' && payload.action ? payload.action : 'submit';

/** Table cell content: strings and numbers render as text; other shapes render nothing rather than being cast. */
const printableCell = (value: unknown): string | number | null =>
  typeof value === 'string' || typeof value === 'number' ? value : null;

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
        <h2 style={{ fontSize, fontWeight: 700, color: 'var(--primitive-color-slate-900)', marginBottom: '12px' }}>
          {node.properties?.text}
        </h2>
      );
    }

    case 'Text': {
      return (
        <p
          style={{
            color: node.properties?.muted ? 'var(--primitive-color-slate-500)' : 'var(--primitive-color-mist-27)',
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
          primary: { bg: 'var(--primitive-color-mist-92)', color: 'var(--primitive-color-purple-32)' },
          secondary: { bg: 'var(--primitive-color-slate-50)', color: 'var(--primitive-color-mist-36)' },
          success: { bg: 'var(--primitive-color-green-96)', color: 'var(--primitive-color-lime-37)' },
          warning: { bg: 'var(--primitive-color-yellow-96-2)', color: 'var(--primitive-color-amber-38)' },
          danger: { bg: 'var(--primitive-color-orange-92)', color: 'var(--primitive-color-orange-33)' },
        }[variant as 'primary'] || { bg: 'var(--primitive-color-mist-92)', color: 'var(--primitive-color-purple-32)' };

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
          {options.map((opt) => {
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
                  border: isSelected ? '2px solid var(--primitive-color-teal-700)' : '1.5px solid var(--primitive-color-slate-200)',
                  background: isSelected ? 'var(--primitive-color-slate-50)' : 'var(--primitive-color-white)',
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
                      border: isSelected ? '6px solid var(--primitive-color-teal-700)' : '2px solid var(--primitive-color-mist-85)',
                      background: 'var(--primitive-color-white)',
                      flexShrink: 0,
                      transition: 'all 0.15s ease',
                      boxShadow: isSelected ? '0 0 0 2px color-mix(in srgb, var(--primitive-color-emerald-600) 25%, transparent)' : 'none',
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--primitive-color-slate-900)' }}>
                      {opt.title}
                    </div>
                    {opt.subtitle && (
                      <div style={{ fontSize: '12px', color: 'var(--primitive-color-slate-500)', marginTop: '2px' }}>
                        {opt.subtitle}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                  {opt.price && (
                    <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--primitive-color-slate-900)' }}>
                      {opt.price}
                    </div>
                  )}
                  {opt.badge && (
                    <span
                      style={{
                        fontSize: '11px',
                        background: 'var(--primitive-color-mist-92)',
                        color: 'var(--primitive-color-purple-35)',
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
                        background: 'var(--primitive-color-green-96)',
                        color: 'var(--primitive-color-lime-37)',
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
                onDispatchAction(actionNameOf(onPressEvent.payload), onPressEvent.payload);
              }
            }
          }}
          style={{
            background: isInteractive ? 'var(--primitive-color-white)' : 'var(--primitive-color-slate-50)',
            border: isInteractive ? '1.5px solid var(--primitive-color-green-90)' : '1px solid var(--primitive-color-slate-200)',
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
                color: isInteractive ? 'var(--primitive-color-green-35)' : 'var(--primitive-color-slate-500)',
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
                <span style={{ fontSize: '10px', background: 'var(--primitive-color-slate-50)', color: 'var(--primitive-color-teal-800)', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>
                  TAP TO OPEN ↗
                </span>
              )}
            </div>
            {node.properties?.subtext && (
              <div style={{ color: 'var(--primitive-color-slate-400)', fontSize: '11px', marginTop: '2px' }}>
                {node.properties?.subtext}
              </div>
            )}
          </div>
          <div style={{ fontWeight: 800, fontSize: '17px', color: 'var(--primitive-color-slate-900)' }}>
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
            background: 'var(--primitive-color-slate-200)',
            border: '1px solid var(--primitive-color-mist-85)',
            borderRadius: '12px',
            minHeight: '180px',
            padding: '14px 4px 30px',
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
              backgroundImage: 'radial-gradient(var(--primitive-color-slate-400) 1.5px, transparent 1.5px)',
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
              stroke="var(--primitive-color-teal-700)"
              strokeWidth="4"
              strokeDasharray="6 4"
            />
          </svg>
          <div style={{ zIndex: 1, display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '10px', justifyContent: 'center' }}>
            {markers.map((m, i) => (
              <div
                key={m.id || i}
                style={{
                  background: 'var(--primitive-color-white)',
                  padding: '6px 12px',
                  borderRadius: '20px',
                  boxShadow: '0 4px 8px color-mix(in srgb, var(--primitive-color-slate-900) 10%, transparent)',
                  fontWeight: 700,
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: 'var(--primitive-color-slate-900)',
                  cursor: 'pointer',
                  border: '1px solid var(--primitive-color-mist-85)',
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
              color: 'var(--primitive-color-green-35)',
              background: 'color-mix(in srgb, var(--primitive-color-white) 90%, transparent)',
              padding: '2px 6px',
              borderRadius: '4px',
              fontWeight: 600,
            }}
          >
            Simulated locations • Dubai / Abu Dhabi
          </div>
        </div>
      );
    }

    case 'DataTable': {
      const columns = Array.isArray(node.properties?.columns) ? node.properties.columns : [];
      const rows = Array.isArray(node.properties?.rows) ? node.properties.rows : [];

      return (
        <div
          style={{
            overflowX: 'auto',
            marginBottom: '16px',
            border: '1px solid var(--primitive-color-slate-200)',
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
              <tr style={{ background: 'var(--primitive-color-slate-50)', borderBottom: '1px solid var(--primitive-color-slate-200)' }}>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    style={{ padding: '10px 14px', color: 'var(--primitive-color-slate-500)', fontWeight: 600 }}
                  >
                    {col.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr
                  key={rIdx}
                  className="ag-table-row"
                  style={{
                    borderBottom: rIdx < rows.length - 1 ? '1px solid var(--primitive-color-slate-50)' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--primitive-color-slate-50)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  {columns.map((col) => (
                    <td key={col.key} style={{ padding: '11px 14px', color: 'var(--primitive-color-slate-800)' }}>
                      {printableCell(row[col.key])}
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
      const storedValue = formValues[inputName];
      const curVal = typeof storedValue === 'string' ? storedValue : (node.properties?.defaultValue || '');

      return (
        <div style={{ marginBottom: '14px' }}>
          {node.properties?.label && (
            <label
              style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--primitive-color-mist-27)',
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
              border: '1px solid var(--primitive-color-mist-85)',
              fontSize: '14px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      );
    }

    case 'MiniAppEmbed': {
      const appId = node.properties?.miniAppId || 'smartcity.miniapp';
      const cleanName = appId.replace('gov.smartcity.', '').replace('org.superapp.', '').toUpperCase();
      return (
        <div
          className="ag-interactive-widget"
          onClick={() => onDispatchAction('LAUNCH_MINIAPP', { miniAppId: appId })}
          style={{
            border: '2px solid var(--primitive-color-teal-700)',
            borderRadius: '14px',
            padding: '20px',
            background: 'linear-gradient(135deg, var(--primitive-color-slate-50) 0%, var(--primitive-color-slate-50) 100%)',
            marginBottom: '16px',
            cursor: 'pointer',
            boxShadow: '0 4px 12px color-mix(in srgb, var(--primitive-color-emerald-600) 8%, transparent)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '20px' }}>🏛️</span>
              <strong style={{ fontSize: '15px', color: 'var(--primitive-color-green-35)' }}>
                Smart City Microfrontend: {appId}
              </strong>
            </div>
            <span style={{ fontSize: '10px', background: 'var(--primitive-color-green-96)', color: 'var(--primitive-color-lime-37)', padding: '3px 8px', borderRadius: '12px', fontWeight: 700 }}>
              ● TAP TO LAUNCH
            </span>
          </div>
          <p style={{ fontSize: '12.5px', color: 'var(--primitive-color-mist-36)', marginBottom: '14px', lineHeight: '1.5' }}>
            Route: <code style={{ background: 'var(--primitive-color-white)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--primitive-color-mist-85)' }}>{node.properties?.entryRoute || '/'}</code> • Sandboxed sovereign microfrontend
          </p>
          <button
            type="button"
            className="ag-btn"
            style={{
              padding: '9px 16px',
              borderRadius: '8px',
              background: 'var(--primitive-color-teal-700)',
              color: 'var(--primitive-color-white)',
              border: 'none',
              fontWeight: 700,
              fontSize: '12.5px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>🚀 Open {cleanName} Mini-App Canvas</span>
            <span>↗</span>
          </button>
        </div>
      );
    }

    case 'Button': {
      const variant = node.properties?.variant || 'primary';
      const isOutline = variant === 'outline';
      const bg = isOutline ? 'var(--primitive-color-white)' : 'var(--primitive-color-teal-700)';
      const textCol = isOutline ? 'var(--primitive-color-teal-700)' : 'var(--primitive-color-white)';
      const border = isOutline ? '1.5px solid var(--primitive-color-teal-700)' : 'none';

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
                const action = actionNameOf(eventBinding.payload);
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
            boxShadow: isOutline ? 'none' : '0 2px 6px color-mix(in srgb, var(--primitive-color-emerald-600) 25%, transparent)',
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
        <div style={{ color: 'var(--primitive-color-red-500)', fontSize: '12px' }}>
          Unsupported component: {node.type}
        </div>
      );
  }
};

