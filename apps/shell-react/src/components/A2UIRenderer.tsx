import React, { useState } from 'react';
import { UIComponentNode } from '@superapp/protocol-core';

interface A2UIRendererProps {
  node: UIComponentNode;
  onDispatchAction: (action: string, payload: Record<string, any>) => void;
}

export const A2UIRenderer: React.FC<A2UIRendererProps> = ({ node, onDispatchAction }) => {
  const [selectedChoice, setSelectedChoice] = useState<string>(
    node.properties?.selectedId || node.properties?.options?.[0]?.id || ''
  );

  switch (node.type) {
    case 'SurfaceCard':
      return (
        <div className="ag-surface-card" id={node.id}>
          {node.children?.map((child) => (
            <A2UIRenderer key={child.id} node={child} onDispatchAction={onDispatchAction} />
          ))}
        </div>
      );

    case 'Heading':
      const level = node.properties?.level || 2;
      return (
        <h2 style={{ fontSize: level === 1 ? '24px' : '18px', fontWeight: 700, marginBottom: '12px' }}>
          {node.properties?.text}
        </h2>
      );

    case 'Text':
      return (
        <p style={{ color: '#475569', fontSize: '14px', lineHeight: '1.5', marginBottom: '12px' }}>
          {node.properties?.text}
        </p>
      );

    case 'ChoiceGroup':
      const options = node.properties?.options || [];
      return (
        <div style={{ marginBottom: '16px' }}>
          {options.map((opt: any) => {
            const isSelected = selectedChoice === opt.id;
            return (
              <div
                key={opt.id}
                className={`ag-choice-item ${isSelected ? 'selected' : ''}`}
                onClick={() => setSelectedChoice(opt.id)}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '15px' }}>{opt.title}</div>
                  {opt.subtitle && <div style={{ fontSize: '12px', color: '#64748b' }}>{opt.subtitle}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  {opt.price && <div style={{ fontWeight: 700, color: '#0f172a' }}>{opt.price}</div>}
                  {opt.badge && (
                    <span style={{ fontSize: '11px', background: '#dbeafe', color: '#1d4ed8', padding: '2px 6px', borderRadius: '4px' }}>
                      {opt.badge}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      );

    case 'MetricWidget':
      return (
        <div style={{ background: '#f1f5f9', padding: '14px', borderRadius: '10px', marginBottom: '14px', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#64748b', fontSize: '13px' }}>{node.properties?.label}</span>
          <span style={{ fontWeight: 700, fontSize: '16px', color: '#0f172a' }}>{node.properties?.value}</span>
        </div>
      );

    case 'Button':
      return (
        <button
          className="ag-btn-primary"
          onClick={() => {
            const eventBinding = node.onEvents?.find((e) => e.event === 'onPress');
            if (eventBinding) {
              const payload = { ...eventBinding.payload, selectedChoice };
              onDispatchAction(eventBinding.payload.action || 'submit', payload);
            }
          }}
        >
          {node.properties?.label}
        </button>
      );

    default:
      return <div>Unsupported component: {node.type}</div>;
  }
};
