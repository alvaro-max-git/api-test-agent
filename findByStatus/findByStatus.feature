Feature: Find pets by status
  Pets can be filtered by their status values.

  Background:
    Given the API base URL is set to {{baseUrl}}

  Scenario Outline: Fetch pets by allowed status
    # Target URL: {{baseUrl}}/pet/findByStatus?status=<status>
    When I send a GET request to /pet/findByStatus with query params
      | status | <status> |
    Then the response status code should be 200
    And the response should have header Content-Type
    And the response Content-Type should include application/json
    And the response body should be a JSON array
    And the response array should have at least 0 items
    And the first array item should have path [0].id

    Examples:
      | status    |
      | available |
      | pending   |
      | sold      |

  Scenario: Fetch pets by multiple statuses
    # Target URL: {{baseUrl}}/pet/findByStatus?status=available,sold
    When I send a GET request to /pet/findByStatus with query params
      | status | available,sold |
    Then the response status code should be 200
    And the response should have header Content-Type
    And the response Content-Type should include application/json
    And the response body should be a JSON array
    And the response array should have at least 0 items
    And the first array item should have path [0].id

  Scenario: Fetch pets without status parameter
    # Target URL: {{baseUrl}}/pet/findByStatus
    When I send a GET request to /pet/findByStatus with no query params
    Then the response status code should be 200
    And the response should have header Content-Type
    And the response Content-Type should include application/json
    And the response body should be a JSON array
    And the response array should have at least 0 items

  Scenario: Reject invalid status value
    # Target URL: {{baseUrl}}/pet/findByStatus?status=not-a-status
    When I send a GET request to /pet/findByStatus with query params
      | status | not-a-status |
    Then the response status code should be 400
    And the response should have header Content-Type
    And the response Content-Type should include application/json
