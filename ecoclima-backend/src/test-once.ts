import { geminiService } from './services/gemini';
import dotenv from 'dotenv';

dotenv.config();

async function runTest() {
  console.log('Iniciando prueba de conexión con Gemini...');
  console.log('API Key en uso:', process.env.GEMINI_API_KEY ? 'Configurada (empieza con ' + process.env.GEMINI_API_KEY.substring(0, 5) + '...)' : 'No configurada');
  
  try {
    const userPhone = '56912345678';
    const message = 'Hola, necesito instalar un aire acondicionado nuevo';
    
    console.log(`\nEnviando mensaje de prueba: "${message}"`);
    const response = await geminiService.handleUserMessage(userPhone, message);
    
    console.log('\n--- RESPUESTA DE GEMINI ---');
    console.log(response);
    console.log('---------------------------');
    console.log('\n¡Conexión verificada con éxito!');
    process.exit(0);
  } catch (error) {
    console.error('\nError durante la prueba de conexión:', error);
    process.exit(1);
  }
}

runTest();
