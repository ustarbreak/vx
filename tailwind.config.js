/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './client-admin/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        cyber: {
          cyan: '#00d4ff',
          purple: '#8b5cf6',
          dark: '#020617',
        },
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(0,212,255,0.2)' },
          '100%': { boxShadow: '0 0 20px rgba(0,212,255,0.5)' },
        },
      },
    },
  },
  plugins: [],
};
