// 複製為 config.js 並在 index.html 於 app.js 前引入：
// <script src="./config.js"></script>
window.GAME_CONFIG = {
  apiBaseUrl: 'https://YOUR_PROJECT.supabase.co/rest/v1',
  apiKey: 'YOUR_SUPABASE_ANON_KEY',
  useSupabaseRest: true,
  truthTable: 'truth_cards',
  dareTable: 'dare_cards',
};

// 或使用自建 API：
// window.GAME_CONFIG = {
//   apiBaseUrl: 'https://your-api.example.com/api',
//   apiKey: '',
//   useSupabaseRest: false,
// };
