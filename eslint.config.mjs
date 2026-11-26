// ESLint flat config. Browser scripts in src/js share globals through window.<Name>; they are
// declared here so no-undef catches typos and missing module loads.
import js from '@eslint/js';
import globals from 'globals';

const projectGlobals = Object.fromEntries([
    'Appearance', 'Apps', 'BRANDS', 'DevLog', 'Home', 'Http', 'Inputs', 'LAUNCHER_CONFIG',
    'LAUNCHER_LOCAL', 'LiveCore', 'LiveEvents', 'LiveHooks', 'LiveParsers', 'LiveQueue', 'LiveHistory', 'LiveRoster', 'SettingsBackgroundLive', 'SomaFM', 'RadioRecord', 'RadioPlan', 'SettingsMusicPickers', 'SettingsBackgroundPins', 'LiveFill', 'LivePool', 'LiveSources', 'LiveStores', 'LiveState', 'LiveWallpaper', 'Music', 'PanMath', 'PhotoUtil',
    'PlatformProbe', 'Prefs', 'RenderProbe', 'Screensaver', 'Settings', 'SettingsAdvanced',
    'SettingsAppearance', 'SettingsBackground', 'SettingsConsoles', 'SettingsCore',
    'SettingsMusic', 'SettingsRename', 'SettingsScreensaver', 'SettingsSound', 'SettingsWeather',
    'Sound', 'Subsonic', 'UI', 'WALLPAPERS', 'Wallpaper', 'Weather', '__TIZEN_MOCK__', 'findBrand',
    'brandKeyFromLabel', 'CONSOLE_COLORS', 'CONSOLE_NAME_MAX', 'consoleTileBg', 'findConsoleColor',
    'tizen'
].map((name) => [name, 'readonly']));

export default [
    {
        ignores: ['dist/**', 'node_modules/**', 'src/js/config.local.js', 'src/img/**']
    },
    js.configs.recommended,
    {
        files: ['src/js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2017,
            sourceType: 'script',
            globals: { ...globals.browser, ...projectGlobals }
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }]
        }
    },
    {
        files: ['test/**/*.mjs', 'scripts/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: globals.node
        },
        rules: {
            'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }]
        }
    }
];
