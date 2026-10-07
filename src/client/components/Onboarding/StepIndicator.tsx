import React from 'react';

interface Props {
  steps: string[];
  currentStep: number; // 0-based index
}

export default function StepIndicator({ steps, currentStep }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 28 }}>
      {steps.map((label, i) => (
        <React.Fragment key={i}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 72 }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: i < currentStep ? 'var(--accent-success)' : i === currentStep ? 'var(--color-point-1)' : 'transparent',
              border: i >= currentStep ? '2px solid var(--border-default)' : 'none',
              flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {i < currentStep && (
                <svg width="6" height="6" viewBox="0 0 6 6" fill="none">
                  <path d="M1 3l1.5 1.5L5 1.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <span style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{label}</span>
          </div>
          {i < steps.length - 1 && (
            <div style={{ flex: 1, height: 2, background: 'var(--border-default)', margin: '4px 4px 0' }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
