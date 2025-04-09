import { supabase } from '@/integrations/supabase/client';

export const getGlobalAsaasConfig = async (): Promise<{ usar_pix_assas: boolean }> => {
  const { data, error } = await supabase
    .from('asaas_config')
    .select('usar_pix_assas')
    .order('id', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    console.warn('Erro ao buscar configuração do Asaas:', error);
    return { usar_pix_assas: false };
  }

  return { usar_pix_assas: !!data.usar_pix_assas };
};
