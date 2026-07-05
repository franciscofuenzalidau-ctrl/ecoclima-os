import readline from 'readline';
import { geminiService } from './services/gemini';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let activeUserPhone = '56912345678';

function promptUser() {
  rl.question('Tú: ', async (input) => {
    if (input.toLowerCase().trim() === 'salir') {
      rl.close();
      return;
    }

    try {
      let reply = '';
      if (input.toLowerCase().startsWith('ubicacion:')) {
        const parts = input.substring(10).trim().split(',');
        const lat = parseFloat(parts[0]);
        const lng = parseFloat(parts[1]);
        
        if (isNaN(lat) || isNaN(lng)) {
          console.log('\nSistema: Coordenadas inválidas. Usa el formato "ubicacion: lat, lng"\n');
          promptUser();
          return;
        }
        
        console.log(`\n[Simulando evento de WhatsApp: Envío de Ubicación GPS (${lat}, ${lng})]`);
        reply = await geminiService.handleUserMessage(activeUserPhone, '', { latitude: lat, longitude: lng });
      } else if (input.toLowerCase().startsWith('imagen:')) {
        const imagePath = input.substring(7).trim();
        const absolutePath = path.resolve(process.cwd(), imagePath);
        
        if (!fs.existsSync(absolutePath)) {
          console.log(`\nSistema: Archivo no encontrado en la ruta: ${absolutePath}\n`);
          promptUser();
          return;
        }
        
        const fileExt = path.extname(absolutePath).toLowerCase();
        let mimeType = 'image/jpeg';
        if (fileExt === '.png') mimeType = 'image/png';
        else if (fileExt === '.gif') mimeType = 'image/gif';
        else if (fileExt === '.webp') mimeType = 'image/webp';

        const base64Data = fs.readFileSync(absolutePath).toString('base64');
        console.log(`\n[Simulando evento de WhatsApp: Envío de Imagen (${path.basename(imagePath)})]`);
        reply = await geminiService.handleUserMessage(
          activeUserPhone, 
          'Analiza esta imagen para el diagnóstico de climatización de Furtz Clima:', 
          undefined, 
          { base64Data, mimeType }
        );
      } else {
        reply = await geminiService.handleUserMessage(activeUserPhone, input);
      }
      console.log(`Bot: ${reply}\n`);
    } catch (err) {
      console.error('Error procesando el mensaje:', err);
    }
    
    promptUser();
  });
}

// Prompt for phone number first
rl.question('Ingresa tu número de celular para simular WhatsApp (presiona Enter para usar 56912345678): ', (phoneInput) => {
  const cleanPhone = phoneInput.replace(/\+/g, '').replace(/\s+/g, '').trim();
  if (cleanPhone) {
    activeUserPhone = cleanPhone;
  }
  console.log(`\nIniciando simulación para el teléfono: +${activeUserPhone}\n`);
  
  console.log('====================================================');
  console.log('    SIMULACIÓN LOCAL DE CHAT: FURTZ CLIMA OS        ');
  console.log('====================================================');
  console.log('Escribe un mensaje para chatear con el bot.');
  console.log('Para enviar una ubicación GPS de WhatsApp, escribe:');
  console.log('  "ubicacion: <lat>, <lng>"  (ej: ubicacion: -33.456, -70.648)');
  console.log('Para enviar una foto/imagen de WhatsApp, escribe:');
  console.log('  "imagen: <ruta_de_archivo>" (ej: imagen: data_mock/ac_sticker_sample.png)');
  console.log('Escribe "salir" para terminar.');
  console.log('====================================================\n');
  
  console.log('Bot: ¡Hola! Soy el Asistente de Furtz Clima. ¿En qué te puedo ayudar hoy? ¿Deseas una instalación de aire acondicionado nueva o programar un servicio de mantenimiento?\n');
  promptUser();
});

