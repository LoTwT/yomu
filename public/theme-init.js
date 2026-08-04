(function applyYomuThemeBeforeMount() {
  var storageKey = 'yomu:v2:preference:theme'
  var preference = 'system'

  try {
    var rawPreference = window.localStorage.getItem(storageKey)
    var storedPreference = rawPreference
    try {
      storedPreference = JSON.parse(rawPreference)
    }
    catch (_parseError) {
      storedPreference = rawPreference
    }
    if (storedPreference === 'light' || storedPreference === 'dark' || storedPreference === 'system') {
      preference = storedPreference
    }
  }
  catch (_error) {
    preference = 'system'
  }

  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  var resolvedTheme = preference === 'system'
    ? (prefersDark ? 'dark' : 'light')
    : preference
  var root = document.documentElement

  root.classList.toggle('dark', resolvedTheme === 'dark')
  root.dataset.theme = resolvedTheme
  root.dataset.themePreference = preference

  var themeColor = document.querySelector('meta[name="theme-color"]')
  if (themeColor) {
    themeColor.setAttribute('content', resolvedTheme === 'dark' ? '#121019' : '#faf8f4')
  }
}())
