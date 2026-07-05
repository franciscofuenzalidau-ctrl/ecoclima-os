import { Router, Request, Response } from 'express';
import { geminiService } from '../services/gemini';
import axios from 'axios';

const router = Router();

// Webhook Verification (GET)
router.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'ecoclima_verify_token_123';

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('Webhook de WhatsApp verificado con éxito.');
    res.status(200).send(challenge);
  } else {
    console.error('Verificación de webhook fallida. Mode o Token incorrecto.');
    res.sendStatus(403);
  }
});

// Webhook Message Reception (POST)
router.post('/', async (req: Request, res: Response) => {
  const body = req.body;

  // Verify that it is a WhatsApp event
  if (body.object === 'whatsapp_business_account') {
    try {
      if (
        body.entry &&
        body.entry[0].changes &&
        body.entry[0].changes[0].value.messages &&
        body.entry[0].changes[0].value.messages[0]
      ) {
        const messageVal = body.entry[0].changes[0].value.messages[0];
        const from = messageVal.from; // Sender phone number
        let reply = '';

        // If the user sends a location
        if (messageVal.type === 'location') {
          const location = messageVal.location;
          reply = await geminiService.handleUserMessage(from, '', {
            latitude: location.latitude,
            longitude: location.longitude
          });
        } 
        // If the user sends an image
        else if (messageVal.type === 'image') {
          const imageObj = messageVal.image;
          const mediaId = imageObj.id;
          const caption = imageObj.caption || '';
          
          const whatsappToken = process.env.WHATSAPP_TOKEN;
          if (whatsappToken && mediaId) {
            try {
              // 1. Get media URL
              const mediaUrlRes = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
                headers: { Authorization: `Bearer ${whatsappToken}` }
              });
              const downloadUrl = mediaUrlRes.data.url;
              const mimeType = mediaUrlRes.data.mime_type || 'image/jpeg';
              
              // 2. Download media binary
              const downloadRes = await axios.get(downloadUrl, {
                headers: { Authorization: `Bearer ${whatsappToken}` },
                responseType: 'arraybuffer'
              });
              
              const base64Data = Buffer.from(downloadRes.data).toString('base64');
              console.log(`[WHATSAPP WEBHOOK] Imagen recibida (${mediaId}). Procesando con Gemini...`);
              
              reply = await geminiService.handleUserMessage(from, caption, undefined, {
                base64Data,
                mimeType
              });
            } catch (mediaError: any) {
              console.error('Error al descargar medio de WhatsApp API:', mediaError.response?.data || mediaError.message);
              reply = 'Disculpa, recibí tu imagen pero no logré descargarla desde los servidores de WhatsApp para analizarla.';
            }
          } else {
            console.log(`[WHATSAPP WEBHOOK] Recibida imagen (${mediaId}) pero WHATSAPP_TOKEN no está configurado. Usando simulación local...`);
            reply = 'He recibido una imagen, pero la integración con los servidores de WhatsApp no está configurada con un token de acceso real.';
          }
        }
        // If the user sends text
        else if (messageVal.type === 'text') {
          const text = messageVal.text.body;
          reply = await geminiService.handleUserMessage(from, text);
        }

        // Send reply back to user via WhatsApp API if configured
        const whatsappToken = process.env.WHATSAPP_TOKEN;
        const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

        if (whatsappToken && phoneId && reply) {
          await sendWhatsAppMessage(phoneId, whatsappToken, from, reply);
        } else {
          console.log(`[Simulación WhatsApp API] De: ${from} | Bot respondió: ${reply}`);
        }
      }
      res.sendStatus(200);
    } catch (error) {
      console.error('Error procesando evento de webhook:', error);
      res.sendStatus(500);
    }
  } else {
    // Return a 404 if the event is not from a WhatsApp API
    res.sendStatus(404);
  }
});

// Helper function to send message using WhatsApp Cloud API
async function sendWhatsAppMessage(phoneId: string, token: string, to: string, text: string) {
  try {
    const url = `https://graph.facebook.com/v18.0/${phoneId}/messages`;
    await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body: text }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      }
    );
    console.log(`Mensaje de WhatsApp enviado con éxito a ${to}`);
  } catch (error: any) {
    console.error('Error enviando mensaje de WhatsApp:', error.response?.data || error.message);
  }
}

export default router;
