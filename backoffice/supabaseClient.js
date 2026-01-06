// backoffice/supabaseClient.js
// Оставляем файл чтобы не ломать структуру репо.
// В backoffice V1 мы НЕ используем Supabase и НЕ требуем anon_key.
(function(){
  window.BO_SUPABASE = {
    enabled: false,
    reason: 'Backoffice V1 працює локально (без авторизації та без Supabase).'
  };
})();
