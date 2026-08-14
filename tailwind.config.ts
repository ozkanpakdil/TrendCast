import type { Config } from 'tailwindcss';

export default {
  content: ['./src/popup/**/*.{ts,tsx}', './src/dashboard/**/*.{ts,tsx}', './index.html'],
  theme: {
    extend: {
      colors: {
        // HypeMarket brand palette
        brand: {
          50: '#eef6ff',
          100: '#d9eaff',
          200: '#bcd9ff',
          300: '#8ec1ff',
          400: '#599dff',
          500: '#3377ff',
          600: '#1a55f5',
          700: '#1540e1',
          800: '#1834b6',
          900: '#1a338f',
        },
        // Semantic colours
        bull: '#16a34a',
        bear: '#dc2626',
        neutral: '#6b7280',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;