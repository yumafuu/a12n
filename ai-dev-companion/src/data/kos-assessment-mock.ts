import type { KOSAssessmentData } from '../types';

/**
 * Mock KOS Assessment Data
 * This should be replaced with actual data source in production
 */
export const mockKOSAssessment: KOSAssessmentData = {
  project_name: 'Sample Client Project',
  overview:
    'This is a web application built with React and Node.js. It provides user authentication, data management, and reporting features.',
  tech_stack: [
    'React 18',
    'TypeScript',
    'Node.js',
    'Express',
    'PostgreSQL',
    'Docker',
  ],
  common_issues: [
    'Authentication token refresh issues',
    'Database connection pool exhaustion under load',
    'React component re-rendering performance',
    'CORS configuration for cross-origin requests',
  ],
};
