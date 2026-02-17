import { useState } from 'react';
import Lumio from './Lumio';

const states = ['idle', 'happy', 'sad', 'celebrate'];

export default function LumioTest() {
  const [current, setCurrent] = useState('idle');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, padding: 40 }}>
      <h2 style={{ fontSize: 24, fontWeight: 'bold' }}>Lumio Test</h2>
      <Lumio state={current} size={150} />
      <div style={{ display: 'flex', gap: 12 }}>
        {states.map((s) => (
          <button
            key={s}
            onClick={() => setCurrent(s)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: current === s ? '2px solid #FACC15' : '2px solid #ccc',
              background: current === s ? '#FACC15' : '#fff',
              fontWeight: current === s ? 'bold' : 'normal',
              cursor: 'pointer',
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
