from cryptography.fernet import Fernet
import os

def get_key():
    """
    Returns the encryption key. It first tries to get the key from the
    FACE_ENCRYPTION_KEY environment variable. If that's not set, it falls
    back to reading from 'secret.key'. If the file doesn't exist, a new
    key is generated and saved, and the user is prompted to set the
    environment variable.
    """
    key = os.environ.get('FACE_ENCRYPTION_KEY')
    if key:
        return key.encode()

    try:
        with open('secret.key', 'rb') as f:
            return f.read()
    except FileNotFoundError:
        print("WARNING: FACE_ENCRYPTION_KEY environment variable not set and no key file found.")
        print("Generating a new encryption key. Please set this key as an environment variable.")
        new_key = Fernet.generate_key()
        with open('secret.key', 'wb') as f:
            f.write(new_key)
        print(f"Your new encryption key is: {new_key.decode()}")
        print("Please set it as the FACE_ENCRYPTION_KEY environment variable for better security.")
        return new_key

cipher_suite = Fernet(get_key())

def encrypt_data(data):
    """
    Encrypts data. The data needs to be in bytes.
    """
    return cipher_suite.encrypt(data)

def decrypt_data(encrypted_data):
    """
    Decrypts data.
    """
    return cipher_suite.decrypt(encrypted_data)
