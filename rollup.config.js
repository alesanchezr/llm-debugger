// rollup.config.js
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'src/front/llm-debugger.js',
  output: {
    file: 'dist/llm-debugger.js',
    format: 'iife', // Immediately Invoked Function Expression for <script> tag
    name: 'LLMDebugger'
  },
  plugins: [resolve(), commonjs()]
};