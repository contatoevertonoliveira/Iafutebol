// Teste da validação corrigida
const API_ENDPOINTS = { footballData: 'https://api.football-data.org/v4' };

async function testFixedValidation(apiKey) {
  console.log('🔍 Testando validação corrigida\n');
  
  console.log('API Key testada:', apiKey ? `${apiKey.substring(0, 10)}...` : '(vazia)');
  
  try {
    // Teste 1: Endpoint /teams/86 (nossa nova validação)
    console.log('\n1. Testando com endpoint /teams/86:');
    const response1 = await fetch(`${API_ENDPOINTS.footballData}/teams/86`, {
      headers: apiKey ? { 'X-Auth-Token': apiKey } : {},
      mode: 'cors'
    });
    
    console.log(`   Status: ${response1.status}`);
    console.log(`   OK: ${response1.ok}`);
    
    if (response1.status === 400) {
      const error = await response1.json();
      console.log(`   Mensagem: ${error.message}`);
      console.log(`   Conclusão: ❌ API key INVÁLIDA`);
      return false;
    } else if (response1.status === 200) {
      console.log(`   Conclusão: ✅ API key VÁLIDA`);
      return true;
    } else if (response1.status === 403) {
      console.log(`   Conclusão: ⚠️  Sem API key ou acesso proibido`);
      return false;
    }
    
  } catch (error) {
    console.log(`   Erro: ${error.message}`);
    
    // Fallback: testar com /competitions
    console.log('\n2. Fallback: testando com endpoint /competitions:');
    try {
      const response2 = await fetch(`${API_ENDPOINTS.footballData}/competitions`, {
        headers: apiKey ? { 'X-Auth-Token': apiKey } : {}
      });
      
      console.log(`   Status: ${response2.status}`);
      console.log(`   OK: ${response2.ok}`);
      
      if (response2.status === 400) {
        console.log(`   Conclusão: ❌ API key INVÁLIDA (fallback)`);
        return false;
      } else if (response2.ok) {
        console.log(`   Conclusão: ✅ API key PROVAVELMENTE VÁLIDA (fallback)`);
        return true;
      }
    } catch (fallbackError) {
      console.log(`   Erro no fallback: ${fallbackError.message}`);
    }
  }
  
  return false;
}

// Testar cenários
async function runAllTests() {
  console.log('='.repeat(60));
  console.log('TESTE COMPLETO DA VALIDAÇÃO DE API KEY');
  console.log('='.repeat(60));
  
  // Teste 1: Sem API key
  console.log('\n📋 TESTE 1: Sem API key');
  await testFixedValidation('');
  
  // Teste 2: API key inválida
  console.log('\n📋 TESTE 2: API key inválida');
  await testFixedValidation('invalid-key-12345');
  
  // Teste 3: API key do usuário (simulada)
  console.log('\n📋 TESTE 3: API key do usuário');
  console.log('Nota: Este teste requer uma API key real');
  console.log('Para testar: node test-validation-fixed.js SUA_API_KEY');
  
  // Se foi passada uma API key como argumento
  if (process.argv[2]) {
    const userApiKey = process.argv[2];
    console.log(`\n📋 TESTE COM API KEY DO USUÁRIO:`);
    const isValid = await testFixedValidation(userApiKey);
    console.log(`\n🎯 RESULTADO FINAL: ${isValid ? '✅ VÁLIDA' : '❌ INVÁLIDA'}`);
  }
}

runAllTests();