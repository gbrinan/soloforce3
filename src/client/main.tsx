import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  MantineProvider,
  localStorageColorSchemeManager,
} from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { DatesProvider } from '@mantine/dates';
import 'dayjs/locale/ko';
import App from './App';
import { theme } from './theme';
import { DialogProvider } from './components/Dialog/dialog';
import { I18nProvider } from './i18n/I18nProvider';
import 'pretendard/dist/web/variable/pretendardvariable.css';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dates/styles.css';
import './styles.css';
import './dialog.css';

const colorSchemeManager = localStorageColorSchemeManager({
  key: 'jarvis-color-scheme',
});

const root = createRoot(document.getElementById('root')!);

if (window.location.hash === '#shadcn-playground') {
  import('./components/ShadcnPlayground').then(({ ShadcnPlayground }) => {
    root.render(
      <StrictMode>
        <ShadcnPlayground />
      </StrictMode>
    );
  });
} else {
  root.render(
    <StrictMode>
      <MantineProvider
        theme={theme}
        defaultColorScheme="dark"
        colorSchemeManager={colorSchemeManager}
      >
        <Notifications position="top-right" />
        <DatesProvider settings={{ locale: 'ko', firstDayOfWeek: 1, weekendDays: [0, 6] }}>
          <I18nProvider>
            <DialogProvider>
              <App />
            </DialogProvider>
          </I18nProvider>
        </DatesProvider>
      </MantineProvider>
    </StrictMode>
  );
}
