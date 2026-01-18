#!/usr/bin/env python3
"""
HTML Reduction Service

Reduces HTML size while preserving semantic meaning for LLM processing.
Tracks reduction metrics for monitoring and optimization.
"""

import re
import logging
from typing import Dict, Optional, Tuple
from bs4 import BeautifulSoup, Comment, NavigableString
from cloud_logging_setup import emit_metric, setup_cloud_logging

setup_cloud_logging()
logger = logging.getLogger(__name__)


class HTMLReductionService:
    """Service for reducing HTML size while preserving semantic meaning."""
    
    def __init__(self):
        """Initialize the HTML reduction service."""
        pass
    
    def reduce_html(self, url: str, html_content: str, aggressive: bool = False) -> Tuple[str, Dict]:
        """Reduce HTML size while preserving semantic meaning.
        
        Args:
            html_content: Original HTML content
            url: for information purposes
            aggressive: If True, more aggressive reduction (removes more attributes)
        
        Returns:
            Tuple of (reduced_html, metrics_dict)
            metrics_dict contains: original_size, reduced_size, reduction_bytes, 
                                   reduction_percent, original_elements, reduced_elements
        """
        original_size = len(html_content)
        
        try:
            soup = BeautifulSoup(html_content, 'html.parser')
            
            # Count semantic elements before reduction
            original_elements = self._count_semantic_elements(soup)
            
            # Remove comments
            for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
                comment.extract()
            
            # Remove script and style tags (they don't contribute to semantic meaning for LLM)
            for tag in soup.find_all(['script', 'style', 'noscript']):
                tag.decompose()
            
            # Remove meta tags that aren't essential for content understanding
            for meta in soup.find_all('meta'):
                # Keep charset and essential meta tags, remove others
                if meta.get('charset'):
                    continue
                if meta.get('name') in ['description', 'keywords', 'og:title', 'og:description']:
                    continue
                meta.decompose()
            
            # Remove links to external resources that don't contain text content
            for link in soup.find_all('link'):
                if link.get('href') or link.get('rel') in ['stylesheet', 'icon', 'apple-touch-icon', 'preload', 'prefetch']:
                    link.decompose()
            
            # Clean up attributes (remove non-semantic ones)
            for tag in soup.find_all(True):  # True means all tags
                # Keep essential attributes
                keep_attrs = ['href', 'src', 'alt', 'title', 'id', 'class', 'type']
                if not aggressive:
                    # Less aggressive: keep more attributes
                    keep_attrs.extend(['aria-label', 'role'])
                
                # Remove attributes not in keep list
                attrs_to_remove = []
                for attr in tag.attrs:
                    if attr not in keep_attrs:
                        # For data-* attributes, only keep if not aggressive
                        if not attr.startswith('data-') or aggressive:
                            attrs_to_remove.append(attr)
                
                for attr in attrs_to_remove:
                    del tag[attr]
                
                # Clean up class attributes - remove excessive classes
                if 'class' in tag.attrs and aggressive:
                    classes = tag.get('class', [])
                    if len(classes) > 3:
                        # Keep only first few classes
                        tag['class'] = classes[:3]
            
            # Remove empty tags (except those with semantic meaning)
            semantic_empty_tags = ['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 
                                  'source', 'track', 'wbr']
            
            for tag in soup.find_all(True):
                if tag.name in semantic_empty_tags:
                    continue
                
                # Remove tags with only whitespace
                text_content = tag.get_text(strip=True)
                if not text_content and not tag.find_all(True):
                    tag.decompose()
            
            # Normalize whitespace in text nodes
            for element in soup.find_all(string=True):
                if isinstance(element, NavigableString):
                    parent = element.parent
                    if parent and parent.name not in ['script', 'style', 'pre', 'code']:
                        # Collapse whitespace but preserve line breaks for readability
                        normalized = re.sub(r'[ \t]+', ' ', element.string)
                        normalized = re.sub(r'\n\s*\n', '\n', normalized)
                        element.replace_with(normalized)
            
            # Get reduced HTML
            reduced_html = str(soup)
            
            # Additional cleanup: remove excessive blank lines
            reduced_html = re.sub(r'\n{3,}', '\n\n', reduced_html)
            
            # Count semantic elements after reduction
            reduced_elements = self._count_semantic_elements(soup)
            
            # Calculate metrics
            reduced_size = len(reduced_html)
            reduction_bytes = original_size - reduced_size
            reduction_percent = (reduction_bytes / original_size * 100) if original_size > 0 else 0
            
            metrics = {
                'original_size': original_size,
                'reduced_size': reduced_size,
                'reduction_bytes': reduction_bytes,
                'reduction_percent': reduction_percent,
                'original_elements': original_elements,
                'reduced_elements': reduced_elements,
                'url': url,
                'elements_preserved': all(
                    original_elements[k] == reduced_elements[k] 
                    for k in original_elements
                ),
                'aggressive_mode': aggressive
            }
            
            # Log metrics
            emit_metric('html_reduction',
                original_size_bytes=original_size,
                reduced_size_bytes=reduced_size,
                reduction_bytes=reduction_bytes,
                reduction_percent=round(reduction_percent, 1),
                original_tokens_est=original_size / 4,  # Rough estimate: ~4 chars/token
                reduced_tokens_est=reduced_size / 4,
                tokens_saved_est=(original_size - reduced_size) / 4,
                aggressive=aggressive,
                elements_preserved=metrics['elements_preserved']
            )
            
            return reduced_html, metrics
            
        except Exception as e:
            logger.error(f"Error reducing HTML: {e}", exc_info=True)
            # Return original HTML on error with empty metrics
            return html_content, {
                'original_size': original_size,
                'reduced_size': original_size,
                'reduction_bytes': 0,
                'reduction_percent': 0,
                'error': str(e)
            }
    
    def _count_semantic_elements(self, soup: BeautifulSoup) -> Dict[str, int]:
        """Count semantic elements in HTML.
        
        Returns:
            Dictionary with counts of headings, paragraphs, links, lists, tables
        """
        return {
            'headings': len(soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])),
            'paragraphs': len(soup.find_all('p')),
            'links': len(soup.find_all('a')),
            'lists': len(soup.find_all(['ul', 'ol'])),
            'tables': len(soup.find_all('table')),
        }

