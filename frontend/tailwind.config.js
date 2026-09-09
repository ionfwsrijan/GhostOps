/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        base: {
          950: '#05070b',
          900: '#0a0e16',
          850: '#0d1220',
          800: '#111827',
          700: '#1a2130',
          600: '#243046',
        },
        ghost: {
          DEFAULT: '#22d3ee',
          dim: '#0e7490',
          glow: '#67e8f9',
        },
        accent: {
          DEFAULT: '#818cf8',
          dim: '#4f46e5',
        },
        success: '#34d399',
        warn: '#fbbf24',
        danger: '#fb7185',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 24px rgba(34, 211, 238, 0.12)',
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.4)',
      },
      backgroundImage: {
        'grid': 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
        'radial-glow': 'radial-gradient(ellipse 60% 40% at 50% -10%, rgba(34,211,238,0.08), transparent)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 2.5s linear infinite',
        shimmer: 'shimmer 2s linear infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
      },
    },
  },
  plugins: [],
};