/* AlfaTrack Role-Based Sound & Haptic Feedback System ("Sonoridad por Rol") — Zero-dependency Web Audio API */
(function (root) {
  'use strict';

  const MUTE_KEY = 'alfatrack_sound_muted';
  let ctx = null;

  const NOTE = {
    F3: 174.61,
    A3: 220.00,
    C4: 261.63,
    E4: 329.63,
    G4: 392.00,
    C5: 523.25,
    D5: 587.33,
    E5: 659.25,
    F5: 698.46,
    G5: 783.99,
    A5: 880.00,
    B5: 987.77,
    C6: 1046.50,
    E6: 1318.51,
  };

  // Pleasant harmonic audio signatures per role and event
  const CUES = {
    // Promotor
    prospect_created: {
      label: 'Prospecto guardado (Promotor)',
      notes: [[NOTE.C5, 0, 0.14, 'sine', 0.14], [NOTE.E5, 0.11, 0.22, 'sine', 0.16]],
      vibrate: 30,
    },
    pescado: {
      label: 'Cliente Pescado / Calificado (Promotor)',
      notes: [
        [NOTE.E5, 0, 0.13, 'triangle', 0.15],
        [NOTE.G5, 0.11, 0.14, 'triangle', 0.16],
        [NOTE.C6, 0.22, 0.30, 'sine', 0.18],
      ],
      vibrate: [40, 60, 40],
    },
    desembolsado: {
      label: 'Crédito Desembolsado (Promotor)',
      notes: [
        [NOTE.C5, 0, 0.11, 'sine', 0.14],
        [NOTE.E5, 0.09, 0.11, 'sine', 0.15],
        [NOTE.G5, 0.18, 0.12, 'triangle', 0.16],
        [NOTE.C6, 0.27, 0.34, 'sine', 0.19],
      ],
      vibrate: [35, 50, 35, 50, 70],
    },
    // Call Center
    new_queue: {
      label: 'Nuevo prospecto en cola (Call Center)',
      notes: [[NOTE.B5, 0, 0.13, 'sine', 0.14], [NOTE.E6, 0.10, 0.25, 'sine', 0.15]],
      vibrate: [30, 40, 30],
    },
    call_saved: {
      label: 'Gestión de llamada guardada (Call Center)',
      notes: [[NOTE.G5, 0, 0.06, 'triangle', 0.11]],
      vibrate: 15,
    },
    // Gerente de Sucursal
    pescado_branch: {
      label: 'Nuevo Pescado en sucursal (Gerente)',
      notes: [[NOTE.G4, 0, 0.18, 'sine', 0.16], [NOTE.D5, 0.15, 0.30, 'sine', 0.17]],
      vibrate: [45, 70, 45],
    },
    // Gestor de Crédito
    assigned_support: {
      label: 'Caso asignado para evaluación (Gestor)',
      notes: [[NOTE.F5, 0, 0.14, 'sine', 0.14], [NOTE.A5, 0.12, 0.24, 'sine', 0.16]],
      vibrate: [35, 50, 35],
    },
    // Administrador General
    admin_ok: {
      label: 'Operación / Sincronización exitosa (Admin)',
      notes: [[NOTE.D5, 0, 0.14, 'sine', 0.12]],
      vibrate: 20,
    },
    admin_warn: {
      label: 'Alerta SQL / Red (Admin)',
      notes: [[NOTE.E4, 0, 0.14, 'triangle', 0.13], [NOTE.C4, 0.13, 0.20, 'triangle', 0.13]],
      vibrate: [50, 40, 50],
    },
    // Todos los roles
    error: {
      label: 'Duplicado / Error de validación',
      notes: [[NOTE.A3, 0, 0.13, 'triangle', 0.15], [NOTE.F3, 0.13, 0.20, 'triangle', 0.14]],
      vibrate: [60, 50, 60],
    },
    notify: {
      label: 'Notificación general',
      notes: [[NOTE.A5, 0, 0.15, 'sine', 0.12]],
      vibrate: 25,
    },
  };

  const ROLE_CUES = {
    promotor: ['prospect_created', 'pescado', 'desembolsado', 'error'],
    callcenter: ['new_queue', 'call_saved', 'error'],
    gerente: ['pescado_branch', 'desembolsado', 'error'],
    gestor: ['assigned_support', 'desembolsado', 'error'],
    admin: ['admin_ok', 'admin_warn', 'new_queue', 'error'],
  };

  function isMuted() {
    try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
  }

  function setMuted(muted) {
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch {}
  }

  function toggleMute() {
    const next = !isMuted();
    setMuted(next);
    return next;
  }

  function getContext() {
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') {
      try { ctx.resume().catch(() => {}); } catch {}
    }
    return ctx;
  }

  function vibrate(pattern) {
    try {
      if (navigator && typeof navigator.vibrate === 'function' && pattern) {
        navigator.vibrate(pattern);
      }
    } catch {}
  }

  function play(cueName, opts) {
    opts = opts || {};
    if (!opts.force && isMuted()) return false;
    const cue = CUES[cueName] || CUES.notify;
    if (!cue) return false;
    vibrate(cue.vibrate);
    try {
      const ac = getContext();
      if (!ac) return false;
      const t0 = ac.currentTime + 0.01;
      for (const [freq, offset, dur, type, vol] of cue.notes) {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, t0 + offset);
        gain.gain.setValueAtTime(0.0001, t0 + offset);
        gain.gain.linearRampToValueAtTime(vol || 0.14, t0 + offset + 0.014);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + dur);
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start(t0 + offset);
        osc.stop(t0 + offset + dur + 0.02);
      }
      return true;
    } catch {
      return false;
    }
  }

  function playForNotification(rol, texto) {
    const t = String(texto || '').toLowerCase();
    if (t.includes('desembolsado')) return play('desembolsado');
    if (t.includes('pescado') || t.includes('calificó')) {
      return play(rol === 'gerente' ? 'pescado_branch' : 'pescado');
    }
    if (t.includes('asignó') || t.includes('apoyo')) return play('assigned_support');
    if (rol === 'callcenter') return play('new_queue');
    return play('notify');
  }

  function playForAction(rol, action, ok) {
    if (!ok) return play(rol === 'admin' ? 'admin_warn' : 'error');
    if (action === 'crearProspecto') return play('prospect_created');
    if (action === 'capturarProspectoCallCenter' || action === 'importarFilasCSV') {
      return play(rol === 'admin' ? 'admin_ok' : 'call_saved');
    }
    if (action === 'cambiarEstado') {
      if (rol === 'callcenter') return play('call_saved');
      if (rol === 'admin') return play('admin_ok');
      return play('prospect_created');
    }
    if (rol === 'admin') return play('admin_ok');
    return play('call_saved');
  }

  // Unlock AudioContext on first user gesture
  if (typeof document !== 'undefined') {
    const unlock = () => {
      try { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); } catch {}
    };
    document.addEventListener('pointerdown', unlock, { passive: true, once: true });
    document.addEventListener('keydown', unlock, { passive: true, once: true });
  }

  root.Sound = {
    CUES,
    ROLE_CUES,
    isMuted,
    setMuted,
    toggleMute,
    play,
    playForNotification,
    playForAction,
  };
})(typeof window !== 'undefined' ? window : globalThis);
