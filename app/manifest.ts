import type {MetadataRoute} from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PKS Live',
    short_name: 'PKS Live',
    description: 'PKS Live - sledzenie autobusow na zywo.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#00A3A2',
    icons: [
      {
        src: '/ikona.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
