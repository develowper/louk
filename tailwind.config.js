import animate from 'tailwindcss-animate'
import defaultTheme from 'tailwindcss/defaultTheme'
import colors from 'tailwindcss/colors'
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  // safelist: ['dark'],
  prefix: '',

  content: [
    './inertia/{pages,components,app,layouts}/**/*.{ts,tsx,vue}',
    './resources/views/**/*.edge',
    './pages/**/*.{ts,tsx,vue}',
    './components/**/*.{ts,tsx,vue}',
    './app/**/*.{ts,tsx,vue}',
    './src/**/*.{ts,tsx,vue}',
    './node_modules/tw-elements/dist/js/**/*.js',
  ],

  theme: {
    extend: {
      fontFamily: {
        sans: ['Yekan', 'Tanha', 'Figtree', ...defaultTheme.fontFamily.sans],
      },
      colors: {
        primary: colors.blue,
        secondary: colors.lime,
      },

      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'collapsible-down': 'collapsible-down 0.2s ease-in-out',
        'collapsible-up': 'collapsible-up 0.2s ease-in-out',
      },
    },
  },
  plugins: [animate],
}
