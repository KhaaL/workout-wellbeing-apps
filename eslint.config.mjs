import globals from 'globals';

// Lint canonical JavaScript, not the generated copies embedded in each HTML
// file. Remaining inline controllers stay covered by the browser suites.
const rules={
  'no-undef':'error',
  'no-unused-vars':['error',{args:'none',caughtErrors:'none'}],
  'no-dupe-args':'error',
  'no-dupe-keys':'error',
  'no-unreachable':'error',
  'no-unsafe-finally':'error',
  'valid-typeof':'error'
};
export default [
  {ignores:['dist/**','node_modules/**','release/**']},
  {files:['packages/**/*.js','apps/bike-cardio/*.js','apps/liftlog/*.js','apps/liftlog/screens/*.js','apps/*/controllers/*.js'],
    languageOptions:{sourceType:'script',globals:{...globals.browser,WorkoutStorage:'readonly',WorkoutCore:'readonly',HeartRateCore:'readonly',BikeTargets:'readonly',BikeHistorySchema:'readonly'}},rules},
  {files:['packages/app-ui/update-worker.js'],languageOptions:{globals:globals.serviceworker}},
  {files:['scripts/*.mjs','eslint.config.mjs'],languageOptions:{globals:globals.node},rules}
];
