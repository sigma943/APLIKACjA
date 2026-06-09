import type {Metadata} from 'next';
import './globals.css';
import { FirebaseProvider } from '@/components/FirebaseProvider';

export const metadata: Metadata = {
  title: 'PKS Live',
  description: 'PKS Live - sledzenie autobusow na zywo.',
  applicationName: 'PKS Live',
  icons: {
    icon: '/ikona.png',
    apple: '/ikona.png',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="pl">
      <head>
        <meta name="theme-color" content="#000000" />
        <script
          dangerouslySetInnerHTML={{
            __html: `!function(){try{var r=(localStorage.getItem("mks_app_theme")||"system").trim().toLowerCase(),t="amoled"===r||"oled"===r||"dark_oled"===r||"darkoled"===r?"dark-oled":r,e="system"===t?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t,o="light"===e?"#f8fafc":"light-warm"===e?"#f2ede1":"dark-oled"===e?"#000000":"dark-aurora"===e?"#06130f":"#111027",a="light"===e?"#020617":"light-warm"===e?"#272116":"#ffffff";document.documentElement.style.setProperty("--pks-initial-bg",o),document.documentElement.style.setProperty("--pks-loading-text",a),document.documentElement.style.backgroundColor=o,document.documentElement.style.color=a,document.documentElement.dataset.pksTheme=e}catch(r){}}();`,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <FirebaseProvider>
          {children}
        </FirebaseProvider>
      </body>
    </html>
  );
}
