import { Handler } from '@netlify/functions';

const ASAAS_API_URL_CUSTOMERS = 'https://sandbox.asaas.com/api/v3/customers';
const ASAAS_API_URL_PAYMENTS = 'https://sandbox.asaas.com/api/v3/payments';

const handler: Handler = async (event) => {
  console.log('Requisição recebida:', { method: event.httpMethod, body: event.body });
  console.log('Versão atualizada para criar pagamento PIX - 2025-04-07');

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido. Use POST.' }) };
  }

  if (!event.body) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Corpo da requisição vazio.' }) };
  }

  try {
    let body;
    try {
      body = JSON.parse(event.body);
    } catch (parseErr) {
      console.error('Erro ao parsear body:', parseErr.message);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Corpo da requisição não é JSON válido', details: parseErr.message }),
      };
    }

    const {
      customer_name: name,
      customer_email: email,
      customer_cpf: cpfCnpj,
      customer_phone: phone,
      price,
      payment_method = 'PIX',
      product_name = 'Assinatura Anual - CineFlick Card',
    } = body;

    console.log('Valor do price recebido:', price);

    if (!name || !email || !cpfCnpj || !price) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Nome, email, CPF/CNPJ e preço são obrigatórios.' }) };
    }

    const apiKey = process.env.ASAAS_API_KEY;
    console.log('🔐 API KEY capturada:', apiKey);
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'API key não configurada.' }) };
    }

    const cleanCpfCnpj = cpfCnpj.replace(/[^\d]/g, '');
    if (cleanCpfCnpj.length !== 11 && cleanCpfCnpj.length !== 14) {
      return { statusCode: 400, body: JSON.stringify({ error: 'CPF ou CNPJ inválido.' }) };
    }

    const asaasCustomerData = {
      name,
      email,
      cpfCnpj: cleanCpfCnpj,
      mobilePhone: phone ? phone.replace(/[^\d]/g, '') : undefined,
    };
    console.log('📤 Enviando dados do cliente:', asaasCustomerData);

    const customerResponse = await fetch(ASAAS_API_URL_CUSTOMERS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'access_token': apiKey,
      },
      body: JSON.stringify(asaasCustomerData),
    });

    let customerData: any = {};
    const customerRaw = await customerResponse.text();
    console.log('👤 Resposta crua do Asaas (cliente):', customerRaw.length > 500 ? customerRaw.slice(0, 500) + '...' : customerRaw);

    try {
      customerData = JSON.parse(customerRaw);
    } catch (err) {
      console.error('❌ Erro ao fazer JSON.parse da resposta de cliente:', err);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Resposta do cliente não é JSON válido',
          raw: customerRaw,
        }),
      };
    }

    if (!customerResponse.ok) {
      return {
        statusCode: customerResponse.status,
        body: JSON.stringify({ error: 'Erro ao criar cliente no Asaas', details: customerData }),
      };
    }

    const asaasPaymentData = {
      customer: customerData.id,
      billingType: payment_method,
      value: parseFloat(price),
      dueDate: new Date().toISOString().split('T')[0],
      description: product_name,
    };
    console.log('📤 Enviando dados do pagamento:', asaasPaymentData);

    const paymentResponse = await fetch(ASAAS_API_URL_PAYMENTS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'access_token': apiKey,
      },
      body: JSON.stringify(asaasPaymentData),
    });

    let paymentData: any = {};
    const paymentRaw = await paymentResponse.text();
    console.log('📦 Resposta crua do Asaas (pagamento):', paymentRaw.length > 500 ? paymentRaw.slice(0, 500) + '...' : paymentRaw);

    try {
      paymentData = JSON.parse(paymentRaw);
    } catch (err) {
      console.error('❌ Erro ao fazer JSON.parse da resposta de pagamento:', err);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Resposta de pagamento não é JSON válido',
          raw: paymentRaw,
        }),
      };
    }

    if (!paymentResponse.ok) {
      return {
        statusCode: paymentResponse.status,
        body: JSON.stringify({ error: 'Erro ao criar pagamento no Asaas', details: paymentData }),
      };
    }

    let qrCodeData = { payload: 'QR_CODE_NOT_AVAILABLE', encodedImage: '' };
    if (paymentData.id) {
      try {
        const qrCodeResponse = await fetch(`${ASAAS_API_URL_PAYMENTS}/${paymentData.id}/pixQrCode`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'access_token': apiKey,
          },
        });

        if (qrCodeResponse.ok) {
          const raw = await qrCodeResponse.text();
          console.log('🔍 Resposta crua do QR Code (length):', raw.length);

          if (raw.trim().length === 0) {
            console.warn('⚠️ Resposta do QR Code completamente vazia.');
          } else {
            try {
              qrCodeData = JSON.parse(raw);
              console.log('✅ QR Code data:', qrCodeData);
            } catch (e) {
              console.warn('❌ Falha ao fazer JSON.parse do QR Code:', e.message);
              console.warn('Conteúdo recebido para parse do QR Code:', raw);
            }
          }
        } else {
          console.warn('❌ QR Code request falhou:', qrCodeResponse.status, qrCodeResponse.statusText);
        }
      } catch (err) {
        console.error('❌ Erro inesperado ao buscar o QR Code:', err);
      }
    }

    const responseWithQrCode = {
      ...paymentData,
      pix: {
        payload: qrCodeData.payload || 'QR_CODE_NOT_AVAILABLE',
        qrCodeImage: qrCodeData.encodedImage || '',
      },
    };

    return { statusCode: 200, body: JSON.stringify(responseWithQrCode) };
  } catch (err) {
    console.error('Erro ao processar requisição:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Erro interno ao criar pagamento', details: err.message }),
    };
  }
};

export { handler };
