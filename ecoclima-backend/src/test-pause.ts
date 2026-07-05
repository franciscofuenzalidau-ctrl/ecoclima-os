import { geminiService } from './services/gemini';
import dotenv from 'dotenv';

dotenv.config();

async function runTest() {
  console.log('Iniciando prueba de pausa para leads en estado "derivado_ventas"...');
  
  try {
    const userPhone = '56912345678'; // Already set to derivado_ventas in mock
    const message = 'Hola, siguen ahí?';
    
    console.log(`\nEnviando mensaje desde teléfono en pausa (+${userPhone}): "${message}"`);
    const response = await geminiService.handleUserMessage(userPhone, message);
    
    console.log('\n--- RESPUESTA DE GEMINI ---');
    console.log(`"${response}"`);
    console.log('---------------------------');
    
    if (response === '') {
      console.log('\n¡Verificación de pausa exitosa! El bot retornó un string vacío.');
      process.exit(0);
    } else {
      console.error('\nError: El bot debería haber retornado un string vacío pero retornó:', response);
      process.exit(1);
    }
  } catch (error) {
    console.error('\nError durante la prueba de pausa:', error);
    process.exit(1);
  }
}

runTest();
