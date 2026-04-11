// Teste do proxy CORS
const API_KEY = 'bd303633dc584b9eb93ec8ba20e3c438'; // Sua API key
const TEAM_ID = 86; // Arsenal

async function testCorsProxy() {
  console.log('🔍 Testando proxy CORS para football-data.org\n');
  
  // URL original
  const originalUrl = `https://api.football-data.org/v4/teams/${TEAM_ID}`;
  console.log('URL original:', originalUrl);
  
  // URL com proxy CORS
  const proxyUrl = `https://cors-anywhere.herokuapp.com/${originalUrl}`;
  console.log('URL com proxy:', proxyUrl);
  
  console.log('\n1. Testando com proxy CORS:');
  try {
    const response = await fetch(proxyUrl, {
      headers: {
        'X-Auth-Token': API_KEY,
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    
    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   OK: ${response.ok}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log(`   Time: ${data.name} (${data.shortName})`);
      console.log(`   ✅ Proxy CORS FUNCIONANDO!`);
      return true;
    } else {
      const errorText = await response.text();
      console.log(`   Erro: ${errorText.substring(0, 200)}`);
    }
  } catch (error) {
    console.log(`   Erro na requisição: ${error.message}`);
  }
  
  console.log('\n2. Testando sem proxy (apenas para comparação):');
  try {
    const response = await fetch(originalUrl, {
      headers: {
        'X-Auth-Token': API_KEY
      }
    });
    
    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   OK: ${response.ok}`);
    
    // Verificar headers CORS
    const corsHeader = response.headers.get('access-control-allow-origin');
    console.log(`   CORS Header: ${corsHeader}`);
    
  } catch (error) {
    console.log(`   Erro: ${error.message}`);
    console.log(`   ⚠️  Provável erro de CORS no navegador`);
  }
  
  console.log('\n🎯 Conclusão:');
  console.log('• O proxy CORS deve resolver o problema de validação no navegador');
  console.log('• cors-anywhere.herokuapp.com é um proxy público para contornar CORS');
  console.log('• Em produção, considere usar seu próprio proxy ou backend');
  
  return false;
}

testCorsProxy();