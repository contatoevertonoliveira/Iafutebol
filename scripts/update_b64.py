#!/usr/bin/env python3
"""
update_b64.py - Atualiza o base64 inline no index.ts
Uso: python3 update_b64.py <secrets.env> <cert.pem> <key.pem> <index.ts>
"""
import base64, sys, os

def main():
    if len(sys.argv) < 5:
        print("Uso: update_b64.py <secrets.env> <cert.pem> <key.pem> <index.ts>", file=sys.stderr)
        sys.exit(1)

    secrets_path = sys.argv[1]
    cert_path = sys.argv[2]
    key_path = sys.argv[3]
    index_path = sys.argv[4]

    # Lê certs
    with open(cert_path) as f:
        cert_data = f.read().strip().replace('\n', '\\n')
    with open(key_path) as f:
        key_data = f.read().strip().replace('\n', '\\n')

    # Lê secrets.env e monta lines
    lines = []
    with open(secrets_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if 'BETFAIR_CERT_PEM_FILE' in line:
                lines.append(f'BETFAIR_CERT_PEM_FILE={cert_data}')
            elif 'BETFAIR_KEY_PEM_FILE' in line:
                lines.append(f'BETFAIR_KEY_PEM_FILE={key_data}')
            else:
                lines.append(line)

    # Gera base64
    raw = '\n'.join(lines)
    b64 = base64.b64encode(raw.encode()).decode()

    # Lê index.ts atual
    with open(index_path) as f:
        content = f.read()

    # Substitui a linha _INLINE_B64
    import re
    new_content = re.sub(
        r'^const _INLINE_B64 = ".*?";',
        f'const _INLINE_B64 = "{b64}";',
        content,
        count=1,
        flags=re.MULTILINE
    )

    if new_content == content:
        print("ERRO: Não encontrou 'const _INLINE_B64' no index.ts", file=sys.stderr)
        sys.exit(1)

    # Escreve
    with open(index_path, 'w') as f:
        f.write(new_content)

    print(f"Base64 atualizado: {len(b64)} bytes ({len(lines)} linhas)")
    print(f"Arquivo: {index_path}")

if __name__ == '__main__':
    main()
