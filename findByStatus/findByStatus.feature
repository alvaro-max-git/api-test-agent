Feature: Fetch pets by status
  Background:
    Given the Petstore service is reachable at {{baseUrl}}

  Scenario Outline: Retrieve pets with a valid status
    # Target URL: {{baseUrl}}/pet/findByStatus
    When I request pets filtered by the status "<status>"
    Then the response status code should be 200
    And the response should be a list of pets
    And the listed pets should include their unique identifiers
    And each pet should reflect one of the requested statuses

    Examples:
      | status    |
      | available |
      | pending   |
      | sold      |

  Scenario Outline: Retrieve pets with multiple statuses
    # Target URL: {{baseUrl}}/pet/findByStatus
    When I request pets filtered by the statuses "<statuses>"
    Then the response status code should be 200
    And the response should be a list of pets
    And the listed pets should include their unique identifiers
    And each pet should reflect one of the requested statuses

    Examples:
      | statuses            |
      | available,pending   |
      | pending,sold        |

  Scenario: Missing status returns an empty list
    # Target URL: {{baseUrl}}/pet/findByStatus
    When I request pets without providing any status filter
    Then the response status code should be 200
    And the response should be empty

  Scenario: Unsupported status is rejected
    # Target URL: {{baseUrl}}/pet/findByStatus
    When I request pets filtered by an unsupported status value
    Then the response status code should be 400
    And the request should be rejected