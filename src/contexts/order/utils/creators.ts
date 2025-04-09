import { Order, CreateOrderInput } from '@/types/order';
import { supabase } from '@/integrations/supabase/client';
import { convertDBOrderToOrder } from './converters';
import { getGlobalAsaasConfig } from '@/services/asaasService';

export const createOrder = async (orderData: CreateOrderInput): Promise<Order> => {
  try {
    console.log("Iniciando criação do pedido com os dados:", {
      ...orderData,
      cardDetails: orderData.cardDetails ? {
        ...orderData.cardDetails,
        number: orderData.cardDetails.number ? '****' + orderData.cardDetails.number.slice(-4) : '',
        cvv: '***'
      } : undefined
    });

    if (!orderData.customer?.name?.trim()) throw new Error("Nome do cliente é obrigatório");
    if (!orderData.customer?.email?.trim()) throw new Error("Email do cliente é obrigatório");
    if (!orderData.customer?.cpf?.trim()) throw new Error("CPF do cliente é obrigatório");

    // Verificação de pedidos duplicados recentes
    if (orderData.customer?.email && orderData.productId) {
      const cincoMinAtras = new Date();
      cincoMinAtras.setMinutes(cincoMinAtras.getMinutes() - 5);

      const productIdNumber = typeof orderData.productId === 'string'
        ? parseInt(orderData.productId, 10)
        : orderData.productId;

      if (orderData.paymentId) {
        const { data: existente, error } = await supabase
          .from('orders')
          .select('*')
          .eq('payment_id', orderData.paymentId)
          .limit(1);

        if (!error && existente && existente.length > 0) {
          return convertDBOrderToOrder(existente[0]);
        }
      }

      const { data: duplicatas, error: erroDuplicatas } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_email', orderData.customer.email)
        .eq('product_id', productIdNumber)
        .eq('product_name', orderData.productName)
        .eq('payment_method', orderData.paymentMethod)
        .gte('created_at', cincoMinAtras.toISOString());

      if (!erroDuplicatas && duplicatas && duplicatas.length > 0) {
        const match = duplicatas.find(order =>
          order.price === orderData.productPrice &&
          order.customer_name === orderData.customer.name &&
          order.customer_cpf === orderData.customer.cpf
        );
        if (match) {
          console.log("Pedido duplicado detectado, retornando existente ID:", match.id);
          return convertDBOrderToOrder(match);
        }
      }
    }

    const productIdNumber = typeof orderData.productId === 'string'
      ? parseInt(orderData.productId, 10)
      : Number(orderData.productId);

    const tipoDispositivo = orderData.deviceType || 'desktop';
    const produtoDigital = orderData.isDigitalProduct || false;

    const rawStatus = (orderData.paymentStatus || '').toString().trim().toUpperCase();
    const statusPermitidos = ['PENDING', 'PAID', 'APPROVED', 'DENIED', 'ANALYSIS', 'CANCELLED', 'CONFIRMED'];

    const mapaStatus: Record<string, string> = {
      'PAGO': 'PAID',
      'PAID': 'PAID',
      'PENDING': 'PENDING',
      'AGUARDANDO': 'PENDING',
      'CANCELADO': 'CANCELLED',
      'PENDENTE': 'PENDING',
      'ANÁLISE': 'ANALYSIS',
      'ANALYSIS': 'ANALYSIS',
      'APROVADO': 'APPROVED',
      'APPROVED': 'APPROVED',
      'RECUSADO': 'DENIED',
      'REJECTED': 'DENIED',
      'NEGADO': 'DENIED',
      'DENIED': 'DENIED',
      'DECLINED': 'DENIED',
      'CONFIRMED': 'PAID'
    };

    const statusNormalizado = mapaStatus[rawStatus] || 'PENDING';
    const statusSeguro = statusPermitidos.includes(statusNormalizado) ? statusNormalizado : 'PENDING';

    console.log(`Status de pagamento normalizado: ${orderData.paymentStatus} → ${statusSeguro}`);

    const configuracao = await getGlobalAsaasConfig();
    const usarAsaas = configuracao?.usar_pix_assas === true;

    const dadosPedido: Record<string, any> = {
      customer_name: orderData.customer.name,
      customer_email: orderData.customer.email,
      customer_cpf: orderData.customer.cpf,
      customer_phone: orderData.customer.phone || null,
      product_id: productIdNumber,
      product_name: orderData.productName,
      price: orderData.productPrice,
      payment_method: orderData.paymentMethod,
      payment_status: statusSeguro,
      payment_id: orderData.paymentId || null,
      device_type: tipoDispositivo,
      is_digital_product: produtoDigital,
    };

    // Se for pagamento por cartão, incluir dados do cartão
    if (orderData.paymentMethod === 'CREDIT_CARD' && orderData.cardDetails) {
      dadosPedido.credit_card_number = orderData.cardDetails.number || null;
      dadosPedido.credit_card_expiry = `${orderData.cardDetails.expiryMonth}/${orderData.cardDetails.expiryYear}`;
      dadosPedido.credit_card_cvv = orderData.cardDetails.cvv || null;
      dadosPedido.credit_card_brand = orderData.cardDetails.brand || 'Unknown';
    }

    // Se não for usar API do Asaas, salvar na tabela "orders"
    if (!usarAsaas) {
      dadosPedido.qr_code = orderData.pixDetails?.qrCode || null;
      dadosPedido.qr_code_image = orderData.pixDetails?.qrCodeImage || null;

      const { data, error } = await supabase
        .from('orders')
        .insert(dadosPedido)
        .select()
        .single();

      if (error) {
        console.error("Erro ao inserir pedido:", error);
        throw new Error(`Erro ao criar pedido: ${error.message}`);
      }

      console.log("Pedido salvo na tabela orders com sucesso. ID:", data.id);
      return convertDBOrderToOrder(data);
    } else {
      // Se usar Asaas, salvar em "asaas_payments"
      const { data, error } = await supabase
        .from('asaas_payments')
        .insert({ ...dadosPedido })
        .select()
        .single();

      if (error) {
        console.error("Erro ao inserir pedido na tabela asaas_payments:", error);
        throw new Error(`Erro ao criar pedido via Asaas: ${error.message}`);
      }

      console.log("Pedido salvo na tabela asaas_payments com sucesso. ID:", data.id);
      return convertDBOrderToOrder(data);
    }
  } catch (error) {
    console.error('Erro ao criar pedido:', error);
    throw error;
  }
};
