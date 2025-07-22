import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class PathGeneratorService {
  /**
   * Build a breadcrumb from a document path
   * @throws {Error} If path is empty or invalid
   */
  buildBreadcrumb(path: string): Array<{ name: string; path: string }> {
    if (!path || typeof path !== 'string' || path.trim() === '') {
      throw new Error('Path must be a non-empty string');
    }
    
    const parts = path.split('/');
    const breadcrumb = [];
    let currentPath = '';
    
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      breadcrumb.push({
        name: part,
        path: currentPath
      });
    }
    
    return breadcrumb;
  }
}
