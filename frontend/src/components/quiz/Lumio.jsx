// eslint-disable-next-line no-unused-vars -- motion is used as <motion.svg>, <motion.path> etc.
import { motion } from 'framer-motion';

const starPath =
  'M50 5 L61 35 L95 35 L68 55 L79 90 L50 70 L21 90 L32 55 L5 35 L39 35 Z';

const eyeVariants = {
  idle: { scaleY: 1 },
  happy: { scaleY: 1 },
  sad: { scaleY: 0.6 },
  celebrate: { scaleY: 1 },
};

const mouthVariants = {
  idle: { d: 'M40 62 Q50 68 60 62' },
  happy: { d: 'M38 60 Q50 75 62 60' },
  sad: { d: 'M40 68 Q50 60 60 68' },
  celebrate: { d: 'M36 60 Q50 78 64 60' },
};

const bodyVariants = {
  idle: {
    y: [0, -6, 0],
    rotate: 0,
    scale: 1,
    transition: {
      y: { repeat: Infinity, duration: 2, ease: 'easeInOut' },
    },
  },
  happy: {
    y: [0, -18, 0],
    rotate: 0,
    scale: [1, 1.1, 1],
    transition: {
      y: { duration: 0.5, ease: 'easeOut' },
      scale: { duration: 0.5, ease: 'easeOut' },
    },
  },
  sad: {
    y: 4,
    rotate: [0, -3, 3, -2, 0],
    scale: 0.95,
    transition: {
      rotate: { repeat: Infinity, duration: 2, ease: 'easeInOut' },
      y: { duration: 0.4 },
      scale: { duration: 0.4 },
    },
  },
  celebrate: {
    y: [0, -10, 0],
    rotate: [0, 360],
    scale: [1, 1.15, 1],
    transition: {
      rotate: { duration: 0.8, ease: 'easeInOut' },
      y: { duration: 0.8, ease: 'easeInOut' },
      scale: { duration: 0.8, ease: 'easeInOut' },
    },
  },
};

const glowVariants = {
  idle: { opacity: 0, scale: 1 },
  happy: { opacity: 0.3, scale: 1.1, transition: { duration: 0.4 } },
  sad: { opacity: 0, scale: 1 },
  celebrate: {
    opacity: [0, 0.6, 0],
    scale: [1, 1.4, 1],
    transition: { duration: 0.8, ease: 'easeInOut' },
  },
};

export default function Lumio({ state = 'idle', size = 100 }) {
  return (
    <motion.svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      variants={bodyVariants}
      animate={state}
      style={{ originX: '50%', originY: '50%' }}
    >
      {/* Glow layer */}
      <motion.path
        d={starPath}
        fill="#FACC15"
        filter="url(#glow)"
        variants={glowVariants}
        animate={state}
      />

      {/* Star body */}
      <path
        d={starPath}
        fill="#FACC15"
        stroke="#EAB308"
        strokeWidth="1.5"
      />

      {/* Left eye */}
      <motion.ellipse
        cx="40"
        cy="45"
        rx="3"
        ry="4"
        fill="#1E293B"
        variants={eyeVariants}
        animate={state}
        transition={{ duration: 0.3 }}
      />

      {/* Right eye */}
      <motion.ellipse
        cx="60"
        cy="45"
        rx="3"
        ry="4"
        fill="#1E293B"
        variants={eyeVariants}
        animate={state}
        transition={{ duration: 0.3 }}
      />

      {/* Mouth */}
      <motion.path
        fill="none"
        stroke="#1E293B"
        strokeWidth="2"
        strokeLinecap="round"
        variants={mouthVariants}
        animate={state}
        transition={{ duration: 0.3 }}
      />

      {/* Glow filter */}
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </motion.svg>
  );
}
