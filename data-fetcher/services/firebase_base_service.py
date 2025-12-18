#!/usr/bin/env python3
"""
Firebase Base Service

Base class for all Firebase services with shared initialization logic.
"""

import os
import firebase_admin
from firebase_admin import credentials, firestore, storage


class FirebaseBaseService:
    """Base service for Firebase operations with shared initialization"""
    
    def __init__(self):
        self._init_firebase()
        self.db = firestore.client()
        self.bucket = storage.bucket()
    
    def _init_firebase(self):
        """Initialize Firebase Admin SDK"""
        if not firebase_admin._apps:
            # Create credentials from environment variables
            private_key = os.getenv("FIREBASE_PRIVATE_KEY")
            if not private_key:
                raise ValueError("FIREBASE_PRIVATE_KEY environment variable is not set")
            
            # Handle the private key formatting
            private_key = private_key.replace('\\n', '\n')
            
            cred_dict = {
                "type": "service_account",
                "project_id": os.getenv("FIREBASE_PROJECT_ID"),
                "private_key_id": os.getenv("FIREBASE_PRIVATE_KEY_ID"),
                "private_key": private_key,
                "client_email": os.getenv("FIREBASE_CLIENT_EMAIL"),
                "client_id": os.getenv("FIREBASE_CLIENT_ID"),
                "auth_uri": os.getenv("FIREBASE_AUTH_URI", "https://accounts.google.com/o/oauth2/auth"),
                "token_uri": os.getenv("FIREBASE_TOKEN_URI", "https://oauth2.googleapis.com/token")
            }
            
            # Use the correct storage bucket from environment or fallback to default
            storage_bucket = os.getenv("FIREBASE_STORAGE_BUCKET") or f"{os.getenv('FIREBASE_PROJECT_ID')}.appspot.com"
            
            cred = credentials.Certificate(cred_dict)
            firebase_admin.initialize_app(cred, {
                'storageBucket': storage_bucket
            })

