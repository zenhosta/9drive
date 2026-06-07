import os
import hashlib
import secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from config import settings

def _get_key() -> bytes:
    key = settings.TOKEN_ENCRYPTION_KEY.encode()
    return key[:32].ljust(32, b'0')

def encrypt_text(plaintext: str) -> str:
    key = _get_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return (nonce + ct).hex()

def decrypt_text(ciphertext_hex: str) -> str:
    key = _get_key()
    aesgcm = AESGCM(key)
    data = bytes.fromhex(ciphertext_hex)
    nonce, ct = data[:12], data[12:]
    return aesgcm.decrypt(nonce, ct, None).decode()

def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

def random_token() -> str:
    return secrets.token_hex(32)
