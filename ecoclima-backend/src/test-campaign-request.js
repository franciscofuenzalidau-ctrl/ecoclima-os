const http = require('http');

function testEndpoint() {
  console.log('Sending POST to http://localhost:3000/api/leads/send-preventive-offers...');
  
  const req = http.request(
    {
      hostname: 'localhost',
      port: 3000,
      path: '/api/leads/send-preventive-offers',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    },
    (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        console.log(`Status Code: ${res.statusCode}`);
        console.log('Response body:', data);
        try {
          const parsed = JSON.parse(data);
          if (parsed.success && parsed.count > 0) {
            console.log('\n--- CAMPAIGN SUCCESS ---');
            console.log(`Successfully sent/simulated campaign offers to ${parsed.count} eligible client(s).`);
            console.log('------------------------');
            process.exit(0);
          } else {
            console.error('\nError: Expected count > 0, got:', data);
            process.exit(1);
          }
        } catch (e) {
          console.error('Failed to parse response JSON:', e);
          process.exit(1);
        }
      });
    }
  );

  req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
    console.log('Server is probably not running on port 3000. Let\'s spin it up!');
    process.exit(2);
  });

  req.end();
}

testEndpoint();
