// Testar diferentes endpoints para encontrar um que realmente valide a API key
const API_ENDPOINTS = { footballData: 'https://api.football-data.org/v4' };

const endpointsToTest = [
  '/competitions',
  '/matches',
  '/areas', 
  '/teams/86', // Arsenal (time específico)
  '/competitions/PL', // Premier League específica
  '/competitions/PL/teams',
  '/competitions/PL/matches'
];

async function testEndpoint(endpoint, apiKey) {
  try {
    const response = await fetch(`${API_ENDPOINTS.footballData}${endpoint}`, {
      headers: apiKey ? { 'X-Auth-Token': apiKey } : {}
    });
    
    return {
      endpoint,
      status: response.status,
      ok: response.ok,
      requiresAuth: false // vamos determinar isso
    };
  } catch (error) {
    return {
      endpoint,
      error: error.message,
      ok: false
    };
  }
}

async function runTests() {
  console.log('🔍 Testando quais endpoints realmente requerem autenticação\n');
  
  // Primeiro testar sem API key
  console.log('1. Testando SEM API key:');
  for (const endpoint of endpointsToTest) {
    const result = await testEndpoint(endpoint, '');
    console.log(`   ${endpoint}: ${result.status} ${result.ok ? '✅' : '❌'}`);
  }
  
  // Testar com API key inválida
  console.log('\n2. Testando com API key INVÁLIDA:');
  for (const endpoint of endpointsToTest) {
    const result = await testEndpoint(endpoint, 'invalid-key-12345');
    console.log(`   ${endpoint}: ${result.status} ${result.ok ? '✅' : '❌'}`);
    
    // Se retorna 400 com API key inválida, mas 200 sem API key, então requer autenticação
    if (result.status === 400) {
      console.log(`     ⚠️  Este endpoint retorna 400 com API key inválida - PODE requerer autenticação`);
    }
  }
  
  console.log('\n🔧 Análise:');
  console.log('• Endpoints que retornam 200 sem API key: não servem para validação');
  console.log('• Endpoints que retornam 400 com API key inválida: bons para validação');
  console.log('• Endpoints que retornam 403/429: também indicam que a API key é verificada');
  console.log('\n💡 Solução:');
  console.log('1. Encontrar um endpoint que retorne erro 400/403 com API key inválida');
  console.log('2. Ou implementar validação baseada no CONTEÚDO da resposta');
  console.log('3. Ou usar um endpoint premium que realmente requer autenticação');
}

runTests();