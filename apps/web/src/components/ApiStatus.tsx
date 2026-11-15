import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

const API_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

export function ApiStatus() {
  const { t } = useTranslation();
  const { isSuccess } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/health`);
      if (!res.ok) throw new Error('down');
      return res.json() as Promise<{ status: string }>;
    },
    refetchInterval: 30_000,
    retry: false,
  });

  return (
    <p className="flex items-center gap-2 whitespace-nowrap">
      <span
        className={`inline-block h-2 w-2 rounded-full ${isSuccess ? 'bg-success-600' : 'bg-danger-600'}`}
      />
      {t('health.api')} : {isSuccess ? t('health.ok') : t('health.down')}
    </p>
  );
}
