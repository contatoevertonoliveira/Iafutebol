// Teste da API do football-data.org
const API_ENDPOINTS = { footballData: 'https://api.football-data.org/v4' };

async function testFootballDataAPI() {
  console.log('⚽ Testando API do football-data.org\n');
  
  // Teste 1: Endpoint sem API key
  console.log('1. Testando endpoint /competitions sem API key:');
  try {
    const response1 = await fetch(`${API_ENDPOINTS.footballData}/competitions`);
    console.log(`   Status: ${response1.status} ${response1.statusText}`);
    console.log(`   OK: ${response1.ok}`);
    
    if (response1.ok) {
      const data = await response1.json();
      console.log(`   Competições retornadas: ${data.competitions?.length || 0}`);
    } else {
      const text = await response1.text();
      console.log(`   Resposta: ${text.substring(0, 200)}`);
    }
  } catch (error) {
    console.log(`   Erro: ${error.message}`);
  }
  
  console.log('\n2. Testando com API key inválida:');
  try {
    const response2 = await fetch(`${API_ENDPOINTS.footballData}/competitions`, {
      headers: {
        'X-Auth-Token': 'invalid-key-12345'
      }
    });
    console.log(`   Status: ${response2.status} ${response2.statusText}`);
    console.log(`   OK: ${response2.ok}`);
    
    const text2 = await response2.text();
    console.log(`   Resposta: ${text2.substring(0, 200)}`);
    
    // Verificar headers CORS
    console.log(`   Access-Control-Allow-Origin: ${response2.headers.get('access-control-allow-origin')}`);
  } catch (error) {
    console.log(`   Erro: ${error.message}`);
  }
  
  console.log('\n3. Testando OPTIONS (pré-voo CORS):');
  try {
    const response3 = await fetch(`${API_ENDPOINTS.footballData}/competitions`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3007',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'X-Auth-Token'
      }
    });
    console.log(`   Status: ${response3.status} ${response3.statusText}`);
    
    // Mostrar headers CORS
    const corsHeaders = {};
    for (const [key, value] of response3.headers.entries()) {
      if (key.toLowerCase().includes('access-control') || key.toLowerCase().includes('allow')) {
        corsHeaders[key] = value;
      }
    }
    console.log(`   Headers CORS:`, JSON.stringify(corsHeaders, null, 2));
  } catch (error) {
    console.log(`   Erro: ${error.message}`);
  }
  
  console.log('\n🔧 Recomendações:');
  console.log('1. Verifique se sua API key está ativa em https://www.football-data.org/client');
  console.log('2. Teste sua API key diretamente:');
  console.log('   curl -H "X-Auth-Token: SUA_API_KEY" https://api.football-data.org/v4/competitions');
  console.log('3. Se funcionar no curl mas não no navegador, é problema de CORS');
  console.log('4. Solução para CORS: usar um proxy ou backend para fazer as requisições');
}

testFootballDataAPI();